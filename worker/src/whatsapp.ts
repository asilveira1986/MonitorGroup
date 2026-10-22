import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  generateMessageIDV2,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type BinaryNode,
  type GroupMetadata,
  type GroupParticipant,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { onClientMessage, resolveDisconnectAlerts } from './alerts.js';
import { clearAuthState, hasAuthState, usePostgresAuthState } from './auth-state.js';
import { closingTemplate, findTeamMember, getSettings, isCompanyActive } from './cache.js';
import { isClosingMessage } from './closing.js';
import { check, db, type GroupRow, type InstanceRow } from './db.js';
import { logger } from './logger.js';
import { AvatarQueue } from './avatars.js';
import { storeMessageMedia } from './media.js';
import { extractContent, isAcknowledgement, isStickerOrEmoji, messageChangeOf, phoneFromJid, quotedMessageId, reactionOf } from './text.js';
import { processDemandSignals } from './demands.js';
import { selfReadIds } from './receipts.js';
import { chooseProfile, isPaired, type MonitorCreds } from './connection-profile.js';

const MAX_QR_ATTEMPTS = 6; // ~2 minutos esperando a leitura do QR code
/** respostas do painel que não saíram neste prazo (WhatsApp desconectado) falham em vez de sair atrasadas */
const OUTBOX_EXPIRE_MS = 10 * 60_000;
const POLL_MS = 3_000;
const HEARTBEAT_MS = 60_000;

type Session = {
  instanceId: string;
  /** empresa dona desta conexão (multiempresa) */
  companyId: string;
  sock: WASocket;
  qrAttempts: number;
  stopped: boolean;
  queue: Promise<void>;
  groupCache: Map<string, GroupRow>;
  /** resolvida quando a lista de grupos foi sincronizada (o histórico espera por ela) */
  groupsReady: Promise<void>;
  markGroupsReady: () => void;
  history: HistoryImport | null;
  /** respostas enviadas pelo painel: id da mensagem no WhatsApp -> nome de quem respondeu */
  outbox: Map<string, string>;
  /** respostas do painel que usaram a mensagem de fechamento (\fechamento) */
  closingOutbox: Set<string>;
  /** LID -> telefone (jid) e nome já descobertos, para não consultar de novo */
  lidPhones: Map<string, string | null>;
  lidNames: Map<string, string>;
  /** fotos de perfil dos participantes e do grupo (uma de cada vez) */
  avatars: AvatarQueue;
};

type HistoryImport = {
  queue: Promise<void>;
  imported: number;
  touchedGroups: Set<string>;
  liveSince: string;
  finishTimer: ReturnType<typeof setTimeout> | null;
};

/** messageTimestamp pode vir como number ou Long */
const toSeconds = (ts: unknown): number => {
  if (typeof ts === 'number') return ts;
  if (ts && typeof (ts as { toNumber?: () => number }).toNumber === 'function') return (ts as { toNumber: () => number }).toNumber();
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? n : Math.floor(Date.now() / 1000);
};

const HISTORY_BATCH = 500;
const HISTORY_IDLE_MS = 30_000; // sem novos lotes por 30s = importação concluída

type OutgoingRow = {
  id: string;
  group_id: string;
  text_to_send: string;
  quoted_message_id: string | null;
  sender_name: string;
  closes_conversation?: boolean;
};

const baileysLogger = logger.child({ module: 'baileys' });
baileysLogger.level = process.env.BAILEYS_LOG_LEVEL ?? 'warn';

export class WhatsAppManager {
  private sessions = new Map<string, Session>();
  private reconnectAttempts = new Map<string, number>();
  private version: [number, number, number] | undefined;

  /** de onde veio a versão anunciada (exibido no painel) */
  private versionSource = 'padrão da biblioteca';

  whatsappVersion() {
    return this.version ? `${this.version.join('.')} (${this.versionSource})` : 'padrão da biblioteca';
  }

  private versionFetchedAt = 0;

  /**
   * Versão do WhatsApp Web anunciada na conexão. Uma versão antiga faz o WhatsApp
   * fechar a conexão antes do QR code (428). Ordem: versão atual publicada em
   * web.whatsapp.com -> versão do repositório da biblioteca -> versão embutida.
   */
  private async refreshVersion(force = false) {
    if (!force && this.version && Date.now() - this.versionFetchedAt < 6 * 3600_000) return;
    const sources = [
      { name: 'web.whatsapp.com', fetch: () => fetchLatestWaWebVersion() },
      { name: 'repositório da biblioteca', fetch: () => fetchLatestBaileysVersion() },
    ];
    for (const source of sources) {
      try {
        const result = await source.fetch();
        if (result.error || !result.isLatest) continue;
        this.version = result.version;
        this.versionSource = source.name;
        this.versionFetchedAt = Date.now();
        logger.info({ version: this.version, source: source.name }, 'versão do WhatsApp Web');
        return;
      } catch {
        /* tenta a próxima fonte */
      }
    }
    logger.warn({ version: this.version }, 'não foi possível obter a versão mais recente do WhatsApp Web');
  }

  /** Fecha as conexões sem deslogar (a sessão continua salva no banco). */
  async shutdown() {
    for (const id of [...this.sessions.keys()]) await this.stop(id);
  }

  async init() {
    await this.refreshVersion(true);

    // Reconecta automaticamente as instâncias que já tinham sessão salva
    const instances = (check(await db.from('whatsapp_instances').select('*'), 'load instances') ?? []) as InstanceRow[];
    for (const inst of instances) {
      if (inst.requested_action) continue; // tratado pelo poll
      // empresa suspensa: a sessão fica salva, mas não conecta
      if (!(await isCompanyActive(inst.company_id))) {
        if (inst.status !== 'disconnected') {
          await this.updateInstance(inst.id, { status: 'disconnected', qr_code: null, last_error: 'Empresa suspensa' });
        }
        continue;
      }
      if (await hasAuthState(inst.id)) {
        await this.start(inst.id);
      } else if (inst.status !== 'disconnected') {
        await this.updateInstance(inst.id, { status: 'disconnected', qr_code: null });
      }
    }

    // envio interrompido por um reinício: não reenvia (poderia duplicar), avisa no painel
    await db
      .from('outgoing_messages')
      .update({ status: 'failed', error: 'Envio interrompido por um reinício do serviço. Confira no WhatsApp e tente de novo se preciso.' })
      .eq('status', 'sending');

    setInterval(() => void this.poll(), POLL_MS);
    setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  status() {
    return [...this.sessions.values()].map((s) => ({ instanceId: s.instanceId, user: s.sock.user?.id ?? null }));
  }

  /** Envia uma mensagem de texto (notificações de alerta) pelo WhatsApp conectado da própria empresa. */
  async sendText(companyId: string, phone: string, text: string) {
    const session = [...this.sessions.values()].find((s) => s.companyId === companyId && s.sock.user && !s.stopped);
    if (!session) throw new Error('nenhum WhatsApp da empresa conectado para enviar a notificação');
    await session.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
  }

  /** Atende os comandos enviados pelo painel (conectar / desconectar). */
  private async poll() {
    try {
      const rows = (check(
        await db.from('whatsapp_instances').select('id, requested_action, company_id, status'),
        'poll instances',
      ) ?? []) as Pick<InstanceRow, 'id' | 'requested_action' | 'company_id' | 'status'>[];
      const ids = new Set(rows.map((r) => r.id));

      for (const row of rows) {
        // empresa suspensa: encerra a conexão (sem apagar a sessão) e ignora pedidos até ser reativada
        if (!(await isCompanyActive(row.company_id))) {
          if (this.sessions.has(row.id)) await this.stop(row.id);
          if (row.requested_action || row.status !== 'disconnected') {
            await this.updateInstance(row.id, {
              requested_action: null,
              status: 'disconnected',
              qr_code: null,
              last_error: 'Empresa suspensa',
            });
          }
          continue;
        }
        if (row.requested_action === 'connect') {
          await this.updateInstance(row.id, { requested_action: null });
          await this.stop(row.id);
          this.reconnectAttempts.delete(row.id);
          await this.start(row.id);
        } else if (row.requested_action === 'logout') {
          await this.updateInstance(row.id, { requested_action: null });
          await this.logout(row.id);
        } else if (row.requested_action === 'reimport') {
          // o WhatsApp só envia o histórico no pareamento: desconecta e gera novo QR code
          await this.updateInstance(row.id, {
            requested_action: null,
            history_status: 'idle',
            history_imported: 0,
            history_started_at: null,
            history_finished_at: null,
          });
          await this.logout(row.id);
          this.reconnectAttempts.delete(row.id);
          await this.start(row.id);
        }
      }

      // instância removida no painel
      for (const id of this.sessions.keys()) {
        if (!ids.has(id)) await this.stop(id);
      }

      await this.processOutbox();
    } catch (err) {
      logger.error({ err }, 'erro ao verificar comandos do painel');
    }
  }

  /**
   * Envia as respostas escritas no painel. A mensagem sai pela própria conexão
   * do número (aparelho conectado), por isso aparece também no celular.
   */
  private async processOutbox() {
    await db
      .from('outgoing_messages')
      .update({ status: 'failed', error: 'Não enviada: o WhatsApp ficou desconectado por mais de 10 minutos.' })
      .eq('status', 'pending')
      .lt('created_at', new Date(Date.now() - OUTBOX_EXPIRE_MS).toISOString());

    for (const session of this.sessions.values()) {
      const me = session.sock.user?.id;
      if (!me || session.stopped) continue;
      const { data } = await db
        .from('outgoing_messages')
        .select('id')
        .eq('instance_id', session.instanceId)
        .eq('status', 'pending')
        .order('created_at')
        .limit(10);
      for (const { id } of (data ?? []) as { id: string }[]) {
        // reserva a mensagem (evita envio duplicado se houver mais de um worker)
        const { data: claimed } = await db
          .from('outgoing_messages')
          .update({ status: 'sending' })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id, group_id, text_to_send, quoted_message_id, sender_name, closes_conversation')
          .maybeSingle();
        if (claimed) await this.sendOutgoing(session, me, claimed as OutgoingRow);
      }
      await this.processMessageActions(session);
    }
  }

  /** Editar / apagar (para todos ou só para o número conectado), pedidos no painel. */
  private async processMessageActions(session: Session) {
    const { data, error } = await db
      .from('message_actions')
      .select('id')
      .eq('instance_id', session.instanceId)
      .eq('status', 'pending')
      .order('created_at')
      .limit(10);
    if (error) return; // sem o script 0066
    for (const { id } of (data ?? []) as { id: string }[]) {
      const { data: row } = await db
        .from('message_actions')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id, action, new_body, message_id')
        .maybeSingle();
      if (!row) continue;
      const fail = (msg: string) =>
        db.from('message_actions').update({ status: 'failed', error: msg, done_at: new Date().toISOString() }).eq('id', id);
      try {
        const { data: m } = await db
          .from('messages')
          .select('id, wa_message_id, body, original_body, from_me, sent_at, groups!messages_group_id_fkey!inner(jid)')
          .eq('id', row.message_id)
          .maybeSingle();
        const jid = (m as { groups?: { jid: string } } | null)?.groups?.jid;
        if (!m || !jid || !m.from_me) {
          await fail('Mensagem não encontrada ou não enviada pelo número conectado.');
          continue;
        }
        const key = { remoteJid: jid, id: m.wa_message_id as string, fromMe: true };
        const now = new Date().toISOString();
        if (row.action === 'edit') {
          await session.sock.sendMessage(jid, { text: row.new_body as string, edit: key });
          await db
            .from('messages')
            .update({ body: row.new_body, edited_at: now, original_body: m.original_body ?? m.body })
            .eq('id', m.id);
        } else if (row.action === 'delete_me') {
          // apaga só no número conectado (celular e aparelhos dele); o grupo continua vendo
          await session.sock.chatModify(
            { deleteForMe: { deleteMedia: false, key, timestamp: Math.floor(new Date(m.sent_at as string).getTime() / 1000) } },
            jid,
          );
          await db.from('messages').update({ hidden_at: now }).eq('id', m.id);
        } else {
          await session.sock.sendMessage(jid, { delete: key });
          await db.from('messages').update({ deleted_at: now }).eq('id', m.id);
        }
        await db.from('message_actions').update({ status: 'done', error: null, done_at: now }).eq('id', id);
      } catch (err) {
        logger.warn({ err, id }, 'falha ao editar/apagar mensagem no WhatsApp');
        await fail(err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async sendOutgoing(session: Session, me: string, row: OutgoingRow) {
    const waId = generateMessageIDV2(me);
    try {
      const { data: group } = await db.from('groups').select('jid').eq('id', row.group_id).single();
      if (!group) throw new Error('grupo não encontrado');

      let quoted: WAMessage | undefined;
      if (row.quoted_message_id) {
        const { data: q } = await db
          .from('messages')
          .select('wa_message_id, sender_jid, from_me, body')
          .eq('id', row.quoted_message_id)
          .maybeSingle();
        if (q) {
          quoted = {
            key: { remoteJid: group.jid, id: q.wa_message_id, fromMe: q.from_me, participant: q.sender_jid ?? undefined },
            message: { conversation: q.body ?? '' },
          };
        }
      }

      // registrado antes do envio: a mensagem volta pelo messages.upsert com o nome de quem respondeu
      session.outbox.set(waId, row.sender_name);
      if (row.closes_conversation) session.closingOutbox.add(waId);
      await session.sock.sendMessage(group.jid, { text: row.text_to_send }, { messageId: waId, quoted });
      await db
        .from('outgoing_messages')
        .update({ status: 'sent', wa_message_id: waId, sent_at: new Date().toISOString(), error: null })
        .eq('id', row.id);
      setTimeout(() => {
        session.outbox.delete(waId);
        session.closingOutbox.delete(waId);
      }, 10 * 60_000);
    } catch (err) {
      session.outbox.delete(waId);
      session.closingOutbox.delete(waId);
      logger.warn({ err, id: row.id }, 'falha ao enviar resposta do painel');
      await db
        .from('outgoing_messages')
        .update({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
        .eq('id', row.id);
    }
  }

  private async heartbeat() {
    for (const s of this.sessions.values()) {
      s.groupCache.clear(); // recarrega alterações feitas no painel (ex.: monitorar/ignorar grupo)
      if (s.sock.user) {
        await this.updateInstance(s.instanceId, { last_seen_at: new Date().toISOString() }).catch(() => {});
      }
    }
  }

  private async updateInstance(id: string, values: Record<string, unknown>) {
    check(await db.from('whatsapp_instances').update(values).eq('id', id), 'update instance');
  }

  async start(instanceId: string) {
    if (this.sessions.has(instanceId)) return;
    const log = logger.child({ instanceId });
    log.info('iniciando conexão com o WhatsApp');

    const { data: inst } = await db.from('whatsapp_instances').select('company_id').eq('id', instanceId).maybeSingle();
    const companyId = (inst?.company_id as string | undefined) ?? null;
    if (!companyId || !(await isCompanyActive(companyId))) {
      log.warn('empresa suspensa ou conexão sem empresa: não conecta');
      return;
    }
    await this.updateInstance(instanceId, { status: 'connecting', last_error: null });
    const { state, saveCreds } = await usePostgresAuthState(instanceId);
    const creds = state.creds as MonitorCreds;
    const paired = isPaired(creds);
    const failedAttempts = this.reconnectAttempts.get(instanceId) ?? 0;
    // pareamento novo: garante a versão atual do WhatsApp Web (versão velha = conexão recusada)
    await this.refreshVersion(!paired && failedAttempts > 0);
    if (this.sessions.has(instanceId)) return;
    const wantsHistory = (await getSettings(companyId)).history_import_days > 0;
    const profile = chooseProfile({ paired, savedProfile: creds.monitorProfile, wantsHistory, failedAttempts });
    // guardado na sessão: depois do QR, as reconexões usam o mesmo perfil
    if (!paired) creds.monitorProfile = profile;
    const importHistory = wantsHistory && profile === 'desktop';
    const startedAt = Date.now();
    log.info({ version: this.version, profile, paired, failedAttempts }, 'abrindo conexão');

    const sock = makeWASocket({
      version: this.version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      // o histórico completo só é enviado para clientes "Desktop"
      browser: profile === 'desktop' ? Browsers.macOS('Desktop') : Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, // mantém as notificações no celular
      syncFullHistory: importHistory,
      // com a importação ligada, aceita também o lote "FULL" (o padrão da biblioteca o ignora)
      ...(importHistory ? { shouldSyncHistoryMessage: () => true } : {}),
      generateHighQualityLinkPreview: false,
    });

    const session: Session = {
      instanceId,
      companyId,
      sock,
      qrAttempts: 0,
      stopped: false,
      queue: Promise.resolve(),
      groupCache: new Map(),
      groupsReady: Promise.resolve(),
      markGroupsReady: () => {},
      history: null,
      outbox: new Map(),
      closingOutbox: new Set(),
      lidPhones: new Map(),
      lidNames: new Map(),
      avatars: null as unknown as AvatarQueue,
    };
    session.avatars = new AvatarQueue(companyId, () => (session.stopped ? null : session.sock));
    session.groupsReady = new Promise((resolve) => (session.markGroupsReady = resolve));
    this.sessions.set(instanceId, session);

    sock.ev.on('creds.update', () => {
      saveCreds().catch((err) => log.error({ err }, 'falha ao salvar credenciais'));
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      try {
        if (qr) {
          session.qrAttempts += 1;
          if (session.qrAttempts > MAX_QR_ATTEMPTS) {
            log.info('QR code expirou sem leitura');
            await this.stop(instanceId);
            await this.updateInstance(instanceId, {
              status: 'disconnected',
              qr_code: null,
              last_error: 'QR code expirou. Clique em "Conectar" para gerar um novo.',
            });
            return;
          }
          await this.updateInstance(instanceId, { status: 'qr', qr_code: qr, qr_updated_at: new Date().toISOString() });
        }

        if (connection === 'open') {
          this.reconnectAttempts.delete(instanceId);
          const me = sock.user;
          log.info({ user: me?.id }, 'WhatsApp conectado');
          await this.updateInstance(instanceId, {
            status: 'connected',
            qr_code: null,
            phone: phoneFromJid(jidNormalizedUser(me?.id)),
            push_name: me?.name ?? null,
            connected_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            last_error: null,
          });
          await resolveDisconnectAlerts(instanceId);
          await this.syncGroups(session);
          session.markGroupsReady();
        }

        if (connection === 'close') {
          if (session.stopped) return;
          this.sessions.delete(instanceId);
          const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const reason = lastDisconnect?.error?.message ?? 'desconhecido';
          log.warn({ code, reason }, 'conexão encerrada');

          if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
            await clearAuthState(instanceId);
            await this.updateInstance(instanceId, {
              status: 'disconnected',
              qr_code: null,
              last_error: 'Sessão encerrada no celular. Conecte novamente lendo o QR code.',
            });
            return;
          }
          if (code === DisconnectReason.connectionReplaced) {
            await this.updateInstance(instanceId, {
              status: 'disconnected',
              last_error: 'Sessão aberta em outro local. Clique em "Conectar" para retomar.',
            });
            return;
          }

          const openSeconds = Math.round((Date.now() - startedAt) / 1000);
          const diagnostic = `versão ${this.whatsappVersion()}, perfil ${profile === 'desktop' ? 'Desktop' : 'Chrome'}, fechou após ${openSeconds}s${session.qrAttempts ? `, ${session.qrAttempts} QR gerado(s)` : ', sem QR'}`;
          log.warn({ code, reason, diagnostic }, 'detalhes da conexão encerrada');

          // QR lido: o WhatsApp pede para reiniciar a conexão com a sessão nova. Não é falha.
          if (code === DisconnectReason.restartRequired) {
            this.reconnectAttempts.delete(instanceId);
            log.info('pareamento concluído; reiniciando a conexão');
            setTimeout(() => void this.start(instanceId).catch((err) => log.error({ err }, 'falha ao reconectar')), 0);
            return;
          }

          // reconexão com backoff exponencial
          const attempt = (this.reconnectAttempts.get(instanceId) ?? 0) + 1;
          this.reconnectAttempts.set(instanceId, attempt);

          // só descarta a sessão se ela ainda não foi pareada (nunca apaga uma sessão já lida no QR)
          if (!isPaired(state.creds)) {
            // ainda não pareado: recomeça com credenciais novas (um pareamento pela metade é recusado de novo)
            await clearAuthState(instanceId);
            // o WhatsApp recusa repetidamente: para e explica
            if (attempt >= 5) {
              this.reconnectAttempts.delete(instanceId);
              await this.updateInstance(instanceId, {
                status: 'disconnected',
                qr_code: null,
                last_error:
                  `O WhatsApp encerrou a conexão ${attempt} vezes antes do QR code (código ${code ?? '?'}: ${reason}). ` +
                  'Causas comuns: outra cópia do worker usando a mesma conexão (mais de 1 réplica no Railway ou o worker ' +
                  'rodando também no seu computador) ou bloqueio temporário após muitas tentativas. Deixe só um worker ' +
                  'ligado, aguarde 10 a 15 minutos e clique em "Conectar". ' +
                  `Diagnóstico da última tentativa: ${diagnostic}.`,
              });
              return;
            }
          }
          const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
          await this.updateInstance(instanceId, {
            status: 'connecting',
            last_error: `Reconectando, tentativa ${attempt} (código ${code ?? '?'}: ${reason})`,
          });
          setTimeout(() => void this.start(instanceId).catch((err) => log.error({ err }, 'falha ao reconectar')), delay);
        }
      } catch (err) {
        log.error({ err }, 'erro ao tratar atualização de conexão');
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // "notify" = mensagens novas; "append" = enviadas por outro aparelho / sincronização recente
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) {
        session.queue = session.queue
          .then(() => this.handleMessage(session, msg))
          .catch((err) => log.error({ err, id: msg.key.id }, 'falha ao processar mensagem'));
      }
    });

    // histórico enviado pelo WhatsApp após o pareamento
    sock.ev.on('messaging-history.set', ({ messages }) => {
      if (messages.length) this.enqueueHistory(session, messages);
    });

    sock.ev.on('groups.upsert', (groups) => {
      for (const g of groups) void this.upsertGroup(session, g).catch((err) => log.error({ err }, 'groups.upsert'));
    });

    sock.ev.on('groups.update', (updates) => {
      for (const u of updates) {
        if (!u.id) continue;
        const values: Record<string, unknown> = {};
        if (u.subject) values.name = u.subject;
        if (u.desc !== undefined) values.description = u.desc;
        if (Object.keys(values).length === 0) continue;
        void db
          .from('groups')
          .update(values)
          .eq('instance_id', instanceId)
          .eq('jid', u.id)
          .then(() => session.groupCache.delete(u.id!));
      }
    });

    sock.ev.on('group-participants.update', ({ id, participants, action, author }) => {
      const includesMe = participants.some((p) => this.isMe(session, p));
      if (action === 'remove' && includesMe) {
        // o número conectado saiu ou foi removido do grupo
        const reason = this.isMe(session, author) ? 'left' : 'removed';
        void this.markRemoved(session, id, reason).catch((err) => log.error({ err }, 'group removed'));
        return;
      }
      void sock
        .groupMetadata(id)
        .then((meta) => this.upsertGroup(session, meta))
        .catch(() => {});
    });

    // o celular conectado leu a conversa do grupo ("read-self"): o que chegou até ali foi visto,
    // inclusive imagens e arquivos (painel: "Imagens e arquivos sem visualização")
    sock.ws.on('CB:receipt', (node: BinaryNode) => {
      const ids = selfReadIds(node);
      if (!ids) return;
      const at = Number(node.attrs.t) > 0 ? new Date(Number(node.attrs.t) * 1000).toISOString() : new Date().toISOString();
      void db
        .rpc('mark_group_seen', { p_instance_id: instanceId, p_group_jid: node.attrs.from, p_wa_ids: ids, p_at: at })
        .then(({ error }) => error && log.warn({ err: error.message }, 'falha ao marcar leitura'));
    });

    // conversa do grupo apagada no celular
    // foto de perfil (contato ou grupo) mudou: busca de novo
    sock.ev.on('contacts.update', (updates) => {
      const changed = updates.filter((u) => u.id && 'imgUrl' in u).map((u) => u.id!);
      if (changed.length) session.avatars.add(changed, true);
    });

    sock.ev.on('chats.delete', (ids) => {
      for (const jid of ids) {
        if (!isJidGroup(jid)) continue;
        void this.markRemoved(session, jid, 'chat_deleted').catch((err) => log.error({ err }, 'chat deleted'));
      }
    });
  }

  async stop(instanceId: string) {
    const session = this.sessions.get(instanceId);
    if (!session) return;
    session.stopped = true;
    session.avatars.stop();
    this.sessions.delete(instanceId);
    try {
      session.sock.end(undefined);
    } catch {
      /* ignore */
    }
  }

  async logout(instanceId: string) {
    const session = this.sessions.get(instanceId);
    if (session) {
      session.stopped = true;
      session.avatars.stop();
      try {
        await session.sock.logout();
      } catch {
        /* ignore */
      }
      this.sessions.delete(instanceId);
    }
    await clearAuthState(instanceId);
    await this.updateInstance(instanceId, {
      status: 'disconnected',
      qr_code: null,
      connected_at: null, // desconexão manual não gera alerta
      last_error: null,
    });
  }

  /** O participante/autor é o próprio número conectado? */
  private isMe(session: Session, who: string | { id?: string; lid?: string; phoneNumber?: string } | null | undefined) {
    const me = session.sock.user;
    if (!me || !who) return false;
    const mine = new Set([me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j!)));
    const ids = typeof who === 'string' ? [who] : [who.id, who.lid, who.phoneNumber];
    return ids.some((j) => j && mine.has(jidNormalizedUser(j)));
  }

  /** Move o grupo para "Excluídos" (o histórico é mantido). */
  private async markRemoved(session: Session, jid: string, reason: string) {
    const { data: group } = await db
      .from('groups')
      .select('id, name, removed_at')
      .eq('instance_id', session.instanceId)
      .eq('jid', jid)
      .maybeSingle();
    session.groupCache.delete(jid);
    if (!group || group.removed_at) return;
    check(await db.rpc('mark_group_removed', { p_group_id: group.id, p_reason: reason }), 'mark_group_removed');
    logger.info({ instanceId: session.instanceId, group: group.name, reason }, 'grupo excluído do WhatsApp');
  }

  private async syncGroups(session: Session) {
    try {
      const groups = await session.sock.groupFetchAllParticipating();
      for (const meta of Object.values(groups)) {
        await this.upsertGroup(session, meta);
      }

      // grupos dos quais o número saiu enquanto o worker estava desligado
      const active = (check(
        await db.from('groups').select('jid').eq('instance_id', session.instanceId).is('removed_at', null),
        'active groups',
      ) ?? []) as { jid: string }[];
      for (const { jid } of active) {
        if (!groups[jid]) await this.markRemoved(session, jid, 'not_participant');
      }
      logger.info({ instanceId: session.instanceId, total: Object.keys(groups).length }, 'grupos sincronizados');
    } catch (err) {
      logger.error({ err }, 'falha ao sincronizar grupos');
    }
  }

  private async upsertGroup(session: Session, meta: Partial<GroupMetadata> & { id: string }): Promise<GroupRow> {
    const settings = await getSettings(session.companyId);
    const existing = (
      await db.from('groups').select('*').eq('instance_id', session.instanceId).eq('jid', meta.id).maybeSingle()
    ).data as GroupRow | null;

    const values = {
      name: meta.subject || existing?.name || 'Grupo sem nome',
      description: meta.desc ?? null,
      participants_count: meta.participants?.length ?? meta.size ?? 0,
      // o número está no grupo de novo: sai da aba "Excluídos"
      removed_at: null,
      removed_reason: null,
    };

    let row: GroupRow;
    if (existing) {
      row = check(
        await db.from('groups').update(values).eq('id', existing.id).select('*').single(),
        'update group',
      ) as GroupRow;
    } else {
      row = check(
        await db
          .from('groups')
          .insert({
            ...values,
            instance_id: session.instanceId,
            jid: meta.id,
            monitored: settings.auto_monitor_new_groups,
          })
          .select('*')
          .single(),
        'insert group',
      ) as GroupRow;
    }
    session.groupCache.set(meta.id, row);
    // imagem do grupo e fotos dos participantes (fila, sem atrasar a sincronização)
    session.avatars.add([meta.id, ...(meta.participants ?? []).map((p) => p.id)]);
    if (meta.participants?.length) {
      await this.syncParticipants(row.id, meta.participants).catch((err) =>
        logger.warn({ err, group: row.name }, 'falha ao gravar os membros do grupo'),
      );
    }
    return row;
  }

  /**
   * Membros do grupo (tela do grupo): grava quem está no grupo agora, com telefone, nome (quando o
   * WhatsApp informa) e se é admin; quem saiu fica com left_at e volta a ativo se entrar de novo.
   */
  private async syncParticipants(groupId: string, participants: GroupParticipant[]) {
    const { data: existing } = await db.from('group_participants').select('jid, name').eq('group_id', groupId);
    const names = new Map((existing ?? []).map((r) => [r.jid as string, r.name as string | null]));
    const now = new Date().toISOString();
    const rows = participants.map((p) => ({
      group_id: groupId,
      jid: p.id,
      lid: p.lid ?? (p.id.endsWith('@lid') ? p.id : null),
      phone: phoneFromJid(p.phoneNumber) ?? phoneFromJid(p.id),
      // o nome só vem às vezes: não apaga um nome já conhecido
      name: p.name || p.notify || names.get(p.id) || null,
      role: p.admin === 'superadmin' || p.isSuperAdmin ? 'superadmin' : p.admin === 'admin' || p.isAdmin ? 'admin' : 'member',
      left_at: null,
      updated_at: now,
    }));
    check(await db.from('group_participants').upsert(rows, { onConflict: 'group_id,jid' }), 'upsert participants');
    const current = new Set(rows.map((r) => r.jid));
    const gone = [...names.keys()].filter((jid) => !current.has(jid));
    if (gone.length) {
      await db.from('group_participants').update({ left_at: now }).eq('group_id', groupId).in('jid', gone).is('left_at', null);
    }
  }

  private async getGroup(session: Session, jid: string): Promise<GroupRow> {
    const cached = session.groupCache.get(jid);
    if (cached) return cached;
    const row = (
      await db.from('groups').select('*').eq('instance_id', session.instanceId).eq('jid', jid).maybeSingle()
    ).data as GroupRow | null;
    if (row) {
      session.groupCache.set(jid, row);
      return row;
    }
    let meta: Partial<GroupMetadata> & { id: string } = { id: jid };
    try {
      meta = await session.sock.groupMetadata(jid);
    } catch {
      /* grupo sem acesso aos metadados */
    }
    return this.upsertGroup(session, meta);
  }

  private async handleMessage(session: Session, msg: WAMessage) {
    const jid = msg.key.remoteJid;
    if (!jid || !isJidGroup(jid) || !msg.message) return;
    const reaction = reactionOf(msg.message);
    if (reaction) return this.handleReaction(session, msg, reaction);
    const change = messageChangeOf(msg.message);
    if (change) return this.applyMessageChange(session, jid, change);
    const content = extractContent(msg.message);
    if (!content) return;

    let group = await this.getGroup(session, jid);
    if (group.removed_at) {
      // chegou mensagem: o número voltou a participar do grupo
      group = check(
        await db.from('groups').update({ removed_at: null, removed_reason: null }).eq('id', group.id).select('*').single(),
        'restore group',
      ) as GroupRow;
      session.groupCache.set(jid, group);
    }
    if (!group.monitored) {
      // o painel pode ter mudado a configuração; confere no banco antes de ignorar
      session.groupCache.delete(jid);
      const fresh = await this.getGroup(session, jid);
      if (!fresh.monitored) return;
    }

    const d = await this.describeMessage(session, msg, content);
    const { fromMe, participant, member, fromTeam, senderPhone, senderName, opensPending, ignoredAsLast, closes } = d;
    const ts = d.sentAtSeconds;

    const result = check(
      await db.rpc('ingest_message', {
        p_group_id: group.id,
        p_wa_message_id: msg.key.id!,
        p_sender_jid: participant,
        p_sender_phone: senderPhone,
        p_sender_name: senderName,
        p_from_me: fromMe,
        p_from_team: fromTeam,
        p_team_member_id: member?.id ?? null,
        p_message_type: content.type,
        p_body: content.body,
        p_sent_at: new Date(ts * 1000).toISOString(),
        p_opens_pending: opensPending,
        p_ignored_as_last: ignoredAsLast,
        p_closes: closes,
      }),
      'ingest_message',
    ) as { inserted: boolean; message_id?: string; stale?: boolean; ignored?: boolean };

    // imagem/áudio: guarda o arquivo para abrir no painel (em segundo plano, não atrasa a mensagem)
    if (result.inserted && result.message_id) {
      void storeMessageMedia({
        sock: session.sock,
        msg,
        companyId: session.companyId,
        groupId: group.id,
        messageId: result.message_id,
        type: content.type,
      }).catch((err) => logger.warn({ err }, 'falha ao guardar o arquivo da mensagem'));
    }

    if (result.inserted && !fromTeam && !result.stale && !result.ignored && result.message_id) {
      await onClientMessage(
        session.companyId,
        { id: group.id, name: group.name },
        { id: result.message_id, body: content.body, senderName },
      );
    }

    // demandas: comandos, cobranças, confirmações, prazos e classificação
    if (result.inserted && !result.stale && result.message_id) {
      await processDemandSignals({
        companyId: session.companyId,
        groupId: group.id,
        groupName: group.name,
        messageId: result.message_id,
        quotedWaId: quotedMessageId(msg.message),
        body: content.body,
        messageType: content.type,
        fromTeam,
        senderName,
        teamMemberId: member?.id ?? null,
        opensPending,
      });
    }
  }

  /**
   * Reação a uma mensagem (👍 ❤️ ...): uma por pessoa por mensagem. Trocar o emoji substitui,
   * tirar a reação apaga. Não é mensagem: não mexe em pendência, tempos nem avisos.
   */
  private async handleReaction(session: Session, msg: WAMessage, reaction: { targetId: string; emoji: string }) {
    const group = await this.getGroup(session, msg.key.remoteJid!);
    if (!group.monitored || group.removed_at) return;
    const { data: target } = await db
      .from('messages')
      .select('id')
      .eq('group_id', group.id)
      .eq('wa_message_id', reaction.targetId)
      .maybeSingle();
    if (!target) return; // mensagem que o sistema não tem (anterior ao monitoramento)
    const d = await this.describeMessage(session, msg, { type: 'reaction', body: reaction.emoji });
    const reactor = d.participant ?? (d.fromMe ? 'me' : null);
    if (!reactor) return;
    if (!reaction.emoji) {
      await db.from('message_reactions').delete().eq('message_id', target.id).eq('reactor_jid', reactor);
      return;
    }
    const { error } = await db.from('message_reactions').upsert(
      {
        company_id: session.companyId,
        group_id: group.id,
        message_id: target.id,
        reactor_jid: reactor,
        reactor_phone: d.senderPhone,
        reactor_name: d.senderName,
        from_team: d.fromTeam,
        team_member_id: d.member?.id ?? null,
        emoji: reaction.emoji,
        reacted_at: new Date(d.sentAtSeconds * 1000).toISOString(),
      },
      { onConflict: 'message_id,reactor_jid' },
    );
    if (error) logger.warn({ err: error.message }, 'não foi possível guardar a reação');
  }

  /** Mensagem editada ou apagada no WhatsApp (por qualquer pessoa): atualiza a conversa. */
  private async applyMessageChange(
    session: Session,
    jid: string,
    change: { kind: 'delete'; targetId: string } | { kind: 'edit'; targetId: string; body: string | null },
  ) {
    const group = await this.getGroup(session, jid);
    const { data: target } = await db
      .from('messages')
      .select('id, body, original_body')
      .eq('group_id', group.id)
      .eq('wa_message_id', change.targetId)
      .maybeSingle();
    if (!target) return;
    const now = new Date().toISOString();
    const patch =
      change.kind === 'delete'
        ? { deleted_at: now }
        : { body: change.body, edited_at: now, original_body: target.original_body ?? target.body };
    const { error } = await db.from('messages').update(patch).eq('id', target.id);
    if (error) logger.warn({ err: error.message }, 'não foi possível registrar a edição/exclusão da mensagem');
  }

  /** Dados comuns de uma mensagem de grupo (remetente, equipe, horário). */
  /**
   * Telefone (como jid @s.whatsapp.net) de quem aparece só pelo LID: primeiro o próprio WhatsApp
   * (relação LID → número guardada pela conexão), depois a lista de membros do grupo.
   */
  private async phoneJidForLid(session: Session, groupJid: string | null | undefined, jid: string | null): Promise<string | null> {
    if (!jid || !jid.endsWith('@lid')) return null;
    const known = session.lidPhones.get(jid);
    if (known) return known;
    let phoneJid: string | null = null;
    try {
      const pn = await (
        session.sock as unknown as { signalRepository?: { lidMapping?: { getPNForLID(l: string): Promise<string | null> } } }
      ).signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) phoneJid = jidNormalizedUser(pn);
    } catch {
      /* sem a relação no aparelho */
    }
    if (!phoneJid && groupJid) {
      const group = session.groupCache.get(groupJid);
      if (group) {
        const { data } = await db
          .from('group_participants')
          .select('phone, name')
          .eq('group_id', group.id)
          .or(`jid.eq.${jid},lid.eq.${jid}`)
          .not('phone', 'is', null)
          .limit(1)
          .maybeSingle();
        if (data?.phone) phoneJid = `${data.phone}@s.whatsapp.net`;
        if (data?.name) session.lidNames.set(jid, data.name as string);
      }
    }
    // só guarda o que achou: sem número, tenta de novo quando a lista de membros for atualizada
    if (phoneJid) session.lidPhones.set(jid, phoneJid);
    return phoneJid;
  }

  private async describeMessage(session: Session, msg: WAMessage, content: { type: string; body: string | null }) {
    const fromMe = Boolean(msg.key.fromMe);
    const participant = fromMe ? jidNormalizedUser(session.sock.user?.id) : (msg.key.participant ?? null);
    // remetente só com LID (identificador interno, sem o número): descobre o telefone para
    // reconhecer a equipe e mostrar nome/telefone na conversa
    const participantAlt =
      (msg.key as { participantAlt?: string }).participantAlt ??
      (fromMe ? null : await this.phoneJidForLid(session, msg.key.remoteJid, participant));
    const member = fromMe ? null : await findTeamMember(session.companyId, participant, participantAlt);
    const settings = await getSettings(session.companyId);
    return {
      fromMe,
      participant,
      member,
      fromTeam: fromMe || Boolean(member),
      senderPhone: phoneFromJid(participant) ?? phoneFromJid(participantAlt),
      senderName: fromMe
        ? (session.outbox.get(msg.key.id ?? '') ?? session.sock.user?.name ?? 'Número conectado')
        : (member?.name ?? msg.pushName ?? session.lidNames.get(participant ?? '') ?? null),
      sentAtSeconds: toSeconds(msg.messageTimestamp),
      opensPending: !(
        settings.ignore_acknowledgements && isAcknowledgement(content.type, content.body, settings.ignore_phrases)
      ),
      // figurinha/emoji do cliente não conta como a última mensagem dele
      ignoredAsLast:
        !fromMe && !member && settings.ignore_stickers_emoji !== false && isStickerOrEmoji(content.type, content.body),
      // \fechamento: encerra a conversa (marcado no envio pelo painel ou reconhecido pelo texto)
      closes:
        (fromMe || Boolean(member)) &&
        (session.closingOutbox.has(msg.key.id ?? '') ||
          isClosingMessage(content.body, await closingTemplate(session.companyId))),
    };
  }

  // -------------------------------------------------------------------
  // Importação do histórico
  // -------------------------------------------------------------------

  private enqueueHistory(session: Session, messages: WAMessage[]) {
    if (!session.history) {
      session.history = {
        queue: Promise.resolve(),
        imported: 0,
        touchedGroups: new Set(),
        liveSince: new Date().toISOString(),
        finishTimer: null,
      };
    }
    const h = session.history;
    if (h.finishTimer) clearTimeout(h.finishTimer);
    h.queue = h.queue
      .then(() => this.importHistoryBatch(session, messages))
      .catch((err) => logger.error({ err }, 'falha ao importar lote do histórico'))
      .finally(() => {
        if (h.finishTimer) clearTimeout(h.finishTimer);
        h.finishTimer = setTimeout(() => {
          h.queue = h.queue.then(() => this.finishHistory(session)).catch((err) =>
            logger.error({ err }, 'falha ao concluir a importação do histórico'),
          );
        }, HISTORY_IDLE_MS);
      });
  }

  private async importHistoryBatch(session: Session, messages: WAMessage[]) {
    const settings = await getSettings(session.companyId);
    if (settings.history_import_days <= 0 || session.stopped) return;
    const cutoff = Date.now() / 1000 - settings.history_import_days * 86400;

    // só grupos já sincronizados, monitorados e ativos (não cria grupos de que o número já saiu)
    await session.groupsReady;
    const groups = (check(
      await db
        .from('groups')
        .select('id, jid')
        .eq('instance_id', session.instanceId)
        .eq('monitored', true)
        .is('removed_at', null),
      'history groups',
    ) ?? []) as { id: string; jid: string }[];
    const groupByJid = new Map(groups.map((g) => [g.jid, g.id]));

    const rows: Record<string, unknown>[] = [];
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || !msg.key.id || !msg.message) continue;
      const groupId = groupByJid.get(jid);
      if (!groupId) continue;
      if (toSeconds(msg.messageTimestamp) < cutoff) continue;
      const content = extractContent(msg.message);
      if (!content) continue;

      const d = await this.describeMessage(session, msg, content);
      rows.push({
        group_id: groupId,
        wa_message_id: msg.key.id,
        sender_jid: d.participant,
        sender_phone: d.senderPhone,
        sender_name: d.senderName,
        from_me: d.fromMe,
        from_team: d.fromTeam,
        team_member_id: d.member?.id ?? null,
        message_type: content.type,
        body: content.body,
        sent_at: new Date(d.sentAtSeconds * 1000).toISOString(),
        opens_pending: d.opensPending && !d.ignoredAsLast,
        ignored_as_last: d.ignoredAsLast,
        closes_conversation: d.closes,
      });
    }
    if (!rows.length) return;

    const h = session.history!;
    if (h.imported === 0) {
      await this.updateInstance(session.instanceId, {
        history_status: 'importing',
        history_imported: 0,
        history_started_at: new Date().toISOString(),
        history_finished_at: null,
      });
    }

    for (let i = 0; i < rows.length; i += HISTORY_BATCH) {
      const chunk = rows.slice(i, i + HISTORY_BATCH);
      // mensagens já existentes são ignoradas; retorna só as inseridas
      const inserted = (check(
        await db
          .from('messages')
          .upsert(chunk, { onConflict: 'group_id,wa_message_id', ignoreDuplicates: true })
          .select('group_id'),
        'history insert',
      ) ?? []) as { group_id: string }[];
      for (const r of inserted) h.touchedGroups.add(r.group_id);
      h.imported += inserted.length;
    }
    await this.updateInstance(session.instanceId, { history_imported: h.imported });
    logger.info({ instanceId: session.instanceId, total: h.imported }, 'histórico importado (parcial)');
  }

  /** Recalcula tempos de resposta e situação dos grupos que receberam histórico. */
  private async finishHistory(session: Session) {
    const h = session.history;
    if (!h) return;
    session.history = null;
    if (h.imported === 0) return;

    for (const groupId of h.touchedGroups) {
      const { error } = await db.rpc('rebuild_group_state', { p_group_id: groupId, p_live_since: h.liveSince });
      if (error) logger.error({ error: error.message, groupId }, 'falha ao recalcular grupo');
      session.groupCache.clear();
    }
    await this.updateInstance(session.instanceId, {
      history_status: 'done',
      history_imported: h.imported,
      history_finished_at: new Date().toISOString(),
    });
    logger.info({ instanceId: session.instanceId, total: h.imported, groups: h.touchedGroups.size }, 'histórico importado');
  }
}
