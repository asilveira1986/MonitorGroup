import { batchPauseMs, inSendWindow, pickDelayMs, pickVariant, RecipientError, renderMessage, typingMs, withOptOutFooter } from './service.js';
import type { BroadcastSettings, BroadcastSock, BroadcastStore, Campaign, Recipient } from './types.js';

type Logger = { info(o: object, m?: string): void; warn(o: object, m?: string): void };

export type BroadcastDeps = {
  store: BroadcastStore;
  getSock: (instanceId: string) => BroadcastSock | undefined;
  /** gera o id da mensagem; é registrado antes do envio para o eco do WhatsApp não contar como resposta da equipe */
  generateId: (sock: BroadcastSock) => string;
  onSending: (id: string) => void;
  /** depois de enviar a uma pessoa (ex.: gravar na conversa privada) */
  afterPersonSent?: (info: { instanceId: string; companyId: string; jid: string; phone: string; waId: string; text: string; campaign: string }) => Promise<void>;
  /** conteúdo de arquivo (imagem, vídeo, documento, áudio) pronto para o WhatsApp */
  buildMedia?: (media: { type: string; mime: string; name: string | null }, buffer: Buffer, caption: string) => Promise<Record<string, unknown>>;
  /** fuso da empresa (janela de horário) */
  getTimezone?: (companyId: string) => Promise<string>;
  logger: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  /** falhas seguidas (do número, não do destinatário) que pausam a campanha */
  maxConsecutiveFailures?: number;
};

const DAY_MS = 24 * 60 * 60_000;

/**
 * Envio dos disparos: no máximo uma mensagem por número a cada ciclo, com intervalo aleatório, pausa a cada
 * lote e limite em 24 h para reduzir o risco de bloqueio. Não há paralelismo entre as mensagens de um número.
 * Falhas seguidas pausam a campanha; o destinatário nunca é reenviado (a reserva é feita antes do envio).
 */
export function createBroadcast(deps: BroadcastDeps) {
  const { store, logger } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rand = deps.rand ?? Math.random;
  const maxFails = deps.maxConsecutiveFailures ?? 5;

  /** instância -> quando pode enviar a próxima */
  const nextAt = new Map<string, number>();
  /** instância -> enviadas no lote atual */
  const batchCount = new Map<string, number>();
  /** campanha -> falhas seguidas do número */
  const fails = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  /** disparos recorrentes: confere a cada 30 s (o banco só cria o que chegou na hora) */
  const SPAWN_EVERY_MS = 30_000;
  let lastSpawnCheck = 0;
  let spawnWarned = false;

  /** arquivo de cada campanha em memória (baixa do Storage uma vez só) */
  const mediaCache = new Map<string, Buffer>();

  async function sendOne(c: Campaign, r: Recipient, sock: BroadcastSock, s: BroadcastSettings): Promise<void> {
    // texto deste destinatário: o principal ou uma variação (sorteio estável pelo id dele)
    const base = renderMessage(pickVariant([c.message, ...c.variants], r.id), { name: r.name });
    const audio = c.media?.type === 'audio'; // áudio não leva texto
    const text = c.target === 'people' && c.optoutFooter && !audio ? withOptOutFooter(base) : base;
    if (!text && !c.media) throw new RecipientError('A mensagem ficou vazia depois de aplicar as variáveis.');
    let jid = r.jid;
    if (r.kind === 'person') {
      if (!r.phone) throw new RecipientError('Contato sem telefone.');
      if (!sock.onWhatsApp) throw new Error('Conexão sem verificação de número.');
      const [found] = (await sock.onWhatsApp(r.phone)) ?? [];
      if (!found?.exists) throw new RecipientError('Este número não tem WhatsApp.');
      jid = found.jid;
    }
    if (!jid) throw new RecipientError('Destinatário sem identificador do WhatsApp.');
    if (sock.sendPresenceUpdate) {
      await sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
      await sleep(typingMs(text));
    }
    const id = deps.generateId(sock);
    deps.onSending(id);
    try {
      let content: Record<string, unknown> = { text };
      if (c.media) {
        if (!deps.buildMedia) throw new Error('Envio de arquivos indisponível.');
        let buffer = mediaCache.get(c.id);
        if (!buffer) {
          buffer = await store.loadMedia(c.media.path);
          mediaCache.set(c.id, buffer);
        }
        content = await deps.buildMedia(c.media, buffer, audio ? '' : text);
      }
      await sock.sendMessage(jid, content, { messageId: id });
    } finally {
      if (sock.sendPresenceUpdate) await sock.sendPresenceUpdate('paused', jid).catch(() => undefined);
    }
    await store.markSent(r.id, id, new Date(now()));
    if (r.kind === 'person' && deps.afterPersonSent && r.instanceId && r.phone) {
      await deps
        .afterPersonSent({ instanceId: r.instanceId, companyId: c.companyId, jid, phone: r.phone, waId: id, text, campaign: c.name })
        .catch((err) => logger.warn({ err }, 'disparo enviado, mas não foi gravado na conversa privada'));
    }
    // intervalo aleatório; a cada lote, uma pausa longa
    const instanceId = r.instanceId as string;
    const inBatch = (batchCount.get(instanceId) ?? 0) + 1;
    if (inBatch >= s.batchSize) {
      batchCount.set(instanceId, 0);
      nextAt.set(instanceId, now() + batchPauseMs(s, rand));
    } else {
      batchCount.set(instanceId, inBatch);
      nextAt.set(instanceId, now() + pickDelayMs(s, rand));
    }
  }

  async function processCampaign(c: Campaign, sentToday: Map<string, number>): Promise<void> {
    // fora dos dias e horas do disparo: espera (nada é perdido, segue quando a janela abrir)
    if (c.window) {
      const tz = deps.getTimezone ? await deps.getTimezone(c.companyId).catch(() => 'America/Sao_Paulo') : 'America/Sao_Paulo';
      if (!inSendWindow(c.window, new Date(now()), tz)) return;
    }
    const s = await store.getSettings(c.companyId);
    const pending = await store.listPending(c.id, 25);
    for (const r of pending) {
      // parou no meio (pausa ou cancelamento) não é visto aqui: a pausa vale no próximo ciclo
      const inst = r.instanceId;
      if (!inst) {
        if (await store.claim(r.id)) await store.markFailed(r.id, 'O número do WhatsApp deste destino não existe mais.');
        continue;
      }
      if ((nextAt.get(inst) ?? 0) > now()) continue;
      const sock = deps.getSock(inst);
      if (!sock || !sock.user) continue; // desconectado: espera voltar
      let used = sentToday.get(inst);
      if (used === undefined) {
        used = await store.countSent(inst, new Date(now() - DAY_MS));
        sentToday.set(inst, used);
      }
      if (used >= s.dailyLimit) continue; // limite de 24 h: segue quando a janela abrir
      if (!(await store.claim(r.id))) continue;
      // quem pediu para sair depois de o disparo ser criado não recebe
      if (r.kind === 'person' && r.phone && (await store.isOptedOut(c.companyId, r.phone))) {
        await store.markSkipped(r.id, 'Pediu para não receber mensagens.');
        continue;
      }
      try {
        await sendOne(c, r, sock, s);
        sentToday.set(inst, used + 1);
        fails.set(c.id, 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await store.markFailed(r.id, message);
        // espera mesmo na falha, para não martelar o número
        nextAt.set(inst, now() + pickDelayMs(s, rand));
        if (err instanceof RecipientError) continue;
        logger.warn({ err, campaign: c.id }, 'falha ao enviar disparo');
        const n = (fails.get(c.id) ?? 0) + 1;
        fails.set(c.id, n);
        if (n >= maxFails) {
          await store.pause(c.id);
          fails.delete(c.id);
          logger.warn({ campaign: c.id, name: c.name }, 'disparo pausado: falhas seguidas no envio');
          return;
        }
      }
    }
    if ((await store.openCount(c.id)) === 0) {
      await store.finish(c.id);
      mediaCache.delete(c.id);
      logger.info({ campaign: c.id, name: c.name }, 'disparo concluído');
    }
  }

  /** Um ciclo: inicia o que chegou na hora e envia o que o ritmo permite. */
  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (now() - lastSpawnCheck >= SPAWN_EVERY_MS) {
        lastSpawnCheck = now();
        // sem o script 0152 a função não existe: os disparos comuns seguem funcionando
        await store.spawnDue().then(
          (n) => n > 0 && logger.info({ n }, 'disparos recorrentes criados'),
          (err) => {
            if (!spawnWarned) {
              spawnWarned = true;
              logger.warn({ err }, 'não foi possível criar os disparos recorrentes (script 0152 rodado?)');
            }
          },
        );
      }
      await store.startDue(new Date(now()));
      const sentToday = new Map<string, number>();
      for (const c of await store.listRunning()) {
        await processCampaign(c, sentToday).catch((err) => logger.warn({ err, campaign: c.id }, 'falha no ciclo do disparo'));
      }
    } catch (err) {
      logger.warn({ err }, 'falha no ciclo dos disparos (script 0150 rodado?)');
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    async start(intervalMs = 3000) {
      const stuck = await store.failStuck().catch(() => 0);
      if (stuck > 0) logger.warn({ stuck }, 'disparos interrompidos por reinício: destinatários marcados como falha');
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type BroadcastService = ReturnType<typeof createBroadcast>;
