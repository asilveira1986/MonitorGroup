import { formatWait } from '../duration.js';
import { DEFAULT_TIMEZONE, isBusinessHours } from './hours.js';
import type { Sender } from './sender.js';
import type { AutomationRule, AutomationStore, EscalationStep, PendingReply } from './types.js';

/**
 * Automação de atendimento (0144): garante que nenhuma mensagem de cliente fique sem resposta sem depender de
 * alguém acompanhando os grupos.
 *
 * Mensagem de cliente num grupo com a automação ligada:
 *   1. acuse de recebimento no próprio grupo, citando a mensagem (texto de dentro ou de fora do horário);
 *   2. alerta em tela (alerts, tipo new_message): chega ao painel pelo Realtime do Supabase;
 *   3. aviso no grupo interno (por exemplo, o Trabalhista);
 *   4. abre uma demanda (automation_pending). Com demanda aberta, novas mensagens só atualizam o alerta.
 * Cobrança (a cada minuto): sem resposta depois de escalateAfterMin, avisa o grupo interno com menção,
 * repete a cada repeatEveryMin até maxEscalations. Fora do horário só cobra com escalateOffHours.
 * Encerramento: mensagem da equipe (ou do número conectado) no grupo encerra as demandas abertas.
 * Chave geral (app_settings.automation_enabled, começa desligada): desligada, não responde, não avisa nem cobra;
 * a resposta da equipe ainda encerra a demanda aberta.
 * As mensagens do próprio bot não contam como resposta (ids guardados no BotRegistry).
 */

type LoggerLike = {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
};

/** Uma mensagem de grupo já gravada, no formato que a automação precisa. */
export type AutomationMessage = {
  companyId: string;
  instanceId: string;
  group: { id: string; jid: string; name: string };
  /** id da mensagem no WhatsApp */
  waMessageId: string;
  /** uuid da mensagem em messages, quando já gravada */
  messageId?: string | null;
  /** equipe (atendente cadastrado, outro número da empresa ou o próprio número conectado) */
  fromTeam: boolean;
  /** nome de quem escreveu */
  senderName: string | null;
  /** texto para os avisos: o da mensagem ou [imagem], [áudio]... */
  text: string;
  sentAt: Date;
  /** a mensagem abre pendência? (agradecimentos e "ok" não abrem) */
  opensPending: boolean;
  /** só mensagens novas (notify) disparam a automação; histórico e sincronizações não */
  isNotify: boolean;
  /** a mensagem original, para citar no acuse */
  quoted?: unknown;
};

/** Ids das mensagens enviadas pela automação: voltam pelo WhatsApp e não podem contar como resposta da equipe. */
export type BotRegistry = { mark(id: string): void; has(id: string | null | undefined): boolean };

export function createBotRegistry(ttlMs = 15 * 60_000, now: () => number = Date.now): BotRegistry {
  const ids = new Map<string, number>();
  return {
    mark(id) {
      const t = now();
      for (const [key, at] of ids) if (t - at > ttlMs) ids.delete(key);
      ids.set(id, t);
    },
    has(id) {
      if (!id) return false;
      const at = ids.get(id);
      return at !== undefined && now() - at <= ttlMs;
    },
  };
}

const TYPE_LABEL: Record<string, string> = {
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  contact: 'contato',
  location: 'localização',
  poll: 'enquete',
};

/** Trecho da mensagem para os avisos: o texto, ou [imagem], [áudio]... (com a legenda, se houver). */
export function messagePreview(type: string, body: string | null | undefined, max = 140): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  const out = type === 'text' || !type ? text : `[${TYPE_LABEL[type] ?? type}]${text ? ` ${text}` : ''}`;
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** Etapa da cobrança de número `index` (0 = a 1ª): a própria etapa ou, passando da última, a última. Sem etapas: null. */
export function stepFor(rule: Pick<AutomationRule, 'escalationSteps'>, index: number): EscalationStep | null {
  const steps = rule.escalationSteps ?? [];
  return steps.length ? steps[Math.min(index, steps.length - 1)] : null;
}

/**
 * Minutos que a cobrança de número `index` espera: desde a mensagem do cliente (a 1ª) ou desde a cobrança anterior
 * (as demais). Vale o tempo da própria etapa; sem ele, "Cobrar depois de" (1ª) ou "Repetir a cada" (demais).
 */
export function waitMinutesFor(rule: Pick<AutomationRule, 'escalationSteps' | 'escalateAfterMin' | 'repeatEveryMin'>, index: number): number {
  const own = index < (rule.escalationSteps ?? []).length ? rule.escalationSteps[index].waitMin : null;
  const minutes = own ?? (index === 0 ? rule.escalateAfterMin : rule.repeatEveryMin);
  // as repetições esperam ao menos 1 minuto (como sempre)
  return Math.max(index === 0 ? 0 : 1, minutes);
}

const mentionToken = (jid: string) => `@${jid.split('@')[0].split(':')[0]}`;
const quote = (text: string) => (text ? `"${text}"` : '');

/** Texto do aviso no grupo interno quando chega a mensagem do cliente. */
export function noticeText(opts: { group: string; client: string | null; preview: string; link: string }): string {
  return [
    '📩 Nova mensagem de cliente sem resposta',
    `Grupo: ${opts.group}`,
    `Cliente: ${opts.client || 'cliente'}`,
    quote(opts.preview),
    opts.link,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Texto da cobrança no grupo interno (com as menções no final). */
export function escalationText(opts: {
  minutes: number;
  group: string;
  client: string | null;
  preview: string;
  link: string;
  mentions: string[];
}): string {
  return [
    `⏰🚨 SEM RESPOSTA há ${formatWait(opts.minutes)}`,
    `Grupo: ${opts.group}`,
    `Cliente: ${opts.client || 'cliente'}`,
    quote(opts.preview),
    opts.link,
    opts.mentions.map(mentionToken).join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

export type AutomationDeps = {
  store: AutomationStore;
  sender: Sender;
  bots: BotRegistry;
  logger: LoggerLike;
  /** fuso da empresa (padrão: America/Sao_Paulo) */
  getTimezone?: (companyId: string) => Promise<string>;
  /** endereço do painel, para o link do grupo nos avisos */
  panelUrl?: string;
  now?: () => Date;
  /** intervalo do verificador de cobranças (padrão: 1 minuto) */
  checkIntervalMs?: number;
  /** por quanto tempo a regra de um grupo fica em memória (padrão: 30 s) */
  ruleCacheMs?: number;
  /** agenda o acuse com espera (padrão: setTimeout; os testes trocam por um relógio manual) */
  schedule?: (fn: () => void, ms: number) => void;
};

/** O banco ainda não tem as tabelas da automação (script 0144 não rodado)? */
const isMissingSchema = (err: unknown) =>
  /automation_(rules|pending|log)|schema cache|does not exist|relation .* does not exist/i.test(err instanceof Error ? err.message : String(err));

/** Demanda recém-aberta sem pendência no sistema: dá tempo da gravação da mensagem terminar antes de concluir "respondido". */
const GRACE_MS = 2 * 60_000;

export function createAutomation(deps: AutomationDeps) {
  const { store, sender, bots, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const timezoneOf = deps.getTimezone ?? (async () => DEFAULT_TIMEZONE);
  const ruleCacheMs = deps.ruleCacheMs ?? 30_000;
  const checkIntervalMs = deps.checkIntervalMs ?? 60_000;
  const panelUrl = (deps.panelUrl ?? '').replace(/\/$/, '');

  const ruleCache = new Map<string, { rule: AutomationRule | null; at: number }>();
  const enabledCache = new Map<string, { on: boolean; at: number }>();
  let notifyJids: { set: Set<string>; at: number } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstCheck: ReturnType<typeof setTimeout> | null = null;
  let checking = false;
  let missingSchemaWarned = false;
  // acuses esperando o tempo da regra (0159); cancelados ao parar o serviço
  const ackTimers = new Set<ReturnType<typeof setTimeout>>();
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        ackTimers.delete(timer);
        fn();
      }, ms);
      timer.unref?.();
      ackTimers.add(timer);
    });

  /** Sem o script do banco (0144): avisa uma vez no log e segue sem agir, em vez de errar a cada mensagem. */
  const failed = (err: unknown, context: string, extra: object = {}) => {
    if (isMissingSchema(err)) {
      if (!missingSchemaWarned) {
        missingSchemaWarned = true;
        logger.warn('[automation] falta rodar o script do banco (supabase/atualizar_banco_parte2.sql, itens 0144 e 0145): a automação de atendimento está parada');
      }
      return;
    }
    logger.error({ err, ...extra }, context);
  };

  const link = (groupId: string) => (panelUrl ? `${panelUrl}/groups/${groupId}` : '');

  const getRule = async (groupId: string) => {
    const t = now().getTime();
    const hit = ruleCache.get(groupId);
    if (hit && t - hit.at < ruleCacheMs) return hit.rule;
    const rule = await store.getRule(groupId);
    ruleCache.set(groupId, { rule, at: t });
    return rule;
  };

  /** A chave geral da empresa está ligada? (lida no máximo a cada ruleCacheMs) */
  const isEnabled = async (companyId: string) => {
    const t = now().getTime();
    const hit = enabledCache.get(companyId);
    if (hit && t - hit.at < ruleCacheMs) return hit.on;
    const on = await store.isEnabled(companyId);
    enabledCache.set(companyId, { on, at: t });
    return on;
  };

  /** o grupo é um dos internos (notifyGroupJid de alguma regra)? Nunca dispara por mensagens nele. */
  const isInternalGroup = async (jid: string) => {
    const t = now().getTime();
    if (!notifyJids || t - notifyJids.at > ruleCacheMs) notifyJids = { set: new Set(await store.listNotifyJids()), at: t };
    return notifyJids.set.has(jid);
  };

  const describe = (client: string | null, preview: string, count: number) =>
    `${client || 'Cliente'}: ${quote(preview) || '[mensagem]'}${count > 1 ? ` · ${count} mensagens aguardando` : ''}`;

  // ------------------------------------------------------------ encerramento
  const closeOpen = async (pending: PendingReply, by: string, at: Date) => {
    const responseSec = Math.max(0, Math.round((at.getTime() - pending.receivedAt.getTime()) / 1000));
    await store.resolvePending(pending.id, by, responseSec, at);
    // alert:resolved: o alerta sai da tela
    await store.resolveAlerts(pending.groupId, at);
    await store.log(pending.companyId, pending.groupId, 'RESOLVED', `${by} respondeu em ${formatWait(responseSec / 60)}`);
  };

  // ------------------------------------------------------------ nova demanda
  const ack = async (m: AutomationMessage, rule: AutomationRule, inside: boolean, at: Date) => {
    if (!rule.ackEnabled) return;
    if (rule.ackCooldownMin > 0 && rule.lastAckAt && at.getTime() - rule.lastAckAt.getTime() < rule.ackCooldownMin * 60_000) return;
    const text = (inside ? rule.ackMessage : rule.ackOffHours).trim();
    if (!text) return;
    try {
      await sender.send({ instanceId: m.instanceId, jid: m.group.jid, text, quoted: m.quoted, typing: true });
      await store.setLastAck(rule.groupId, at);
      ruleCache.delete(rule.groupId);
      await store.log(m.companyId, m.group.id, inside ? 'ACK' : 'ACK_OFFHOURS', null);
    } catch (err) {
      logger.warn({ err, group: m.group.jid }, '[automation] falha ao enviar o acuse');
    }
  };

  const notify = async (m: AutomationMessage, rule: AutomationRule) => {
    try {
      await sender.send({
        instanceId: m.instanceId,
        jid: rule.notifyGroupJid,
        text: noticeText({ group: m.group.name, client: m.senderName, preview: m.text, link: link(m.group.id) }),
      });
      await store.log(m.companyId, m.group.id, 'NOTIFY', `aviso em ${rule.notifyGroupName}`);
    } catch (err) {
      logger.warn({ err, group: m.group.jid }, '[automation] falha ao avisar o grupo interno');
    }
  };

  const openDemand = async (m: AutomationMessage, rule: AutomationRule) => {
    const at = now();
    const inside = isBusinessHours(rule, at, await timezoneOf(m.companyId));
    const pending = await store.createPending({
      companyId: m.companyId,
      groupId: m.group.id,
      instanceId: m.instanceId,
      groupJid: m.group.jid,
      groupName: m.group.name,
      firstMessageId: m.waMessageId,
      clientName: m.senderName,
      preview: m.text,
      messageCount: 1,
      receivedAt: at,
    });
    if (!pending) {
      // duas mensagens chegaram juntas e a outra abriu a demanda primeiro
      const open = await store.getOpenPending(m.group.id);
      if (open) await bump(open, m);
      return;
    }
    // alerta em tela (alert:new, warning)
    try {
      const alertId = await store.createAlert({
        companyId: m.companyId,
        groupId: m.group.id,
        instanceId: m.instanceId,
        messageId: m.messageId ?? null,
        type: 'new_message',
        severity: 'warning',
        title: `Nova mensagem - ${m.group.name}`,
        description: describe(m.senderName, m.text, 1),
      });
      await store.setPendingAlert(pending.id, alertId);
    } catch (err) {
      logger.warn({ err, group: m.group.jid }, '[automation] falha ao criar o alerta em tela');
    }
    if (rule.ackDelaySec > 0) {
      // aviso e alerta saem na hora; o acuse espera o tempo da regra e some se a equipe responder antes
      await notify(m, rule);
      schedule(() => void delayedAck(m, pending.id, inside).catch((err) => logger.warn({ err, group: m.group.jid }, '[automation] falha no acuse com espera')), rule.ackDelaySec * 1000);
      return;
    }
    await ack(m, rule, inside, at);
    await notify(m, rule);
  };

  /** Acuse depois da espera: só sai se a demanda continua aberta (a equipe não respondeu) e a regra segue ligada. */
  const delayedAck = async (m: AutomationMessage, pendingId: string, inside: boolean) => {
    const open = await store.getOpenPending(m.group.id);
    if (!open || open.id !== pendingId) return;
    ruleCache.delete(m.group.id);
    const rule = await getRule(m.group.id);
    if (!rule || !rule.enabled || !(await isEnabled(m.companyId))) return;
    await ack(m, rule, inside, now());
  };

  /** demanda aberta e nova mensagem do cliente: sem novo acuse nem novo aviso, só atualiza o alerta (alert:update) */
  const bump = async (open: PendingReply, m: AutomationMessage) => {
    const count = open.messageCount + 1;
    await store.bumpPending(open.id, m.text, count);
    if (open.alertId) await store.updateAlert(open.alertId, { description: describe(m.senderName ?? open.clientName, m.text, count) });
  };

  // ------------------------------------------------------------ entrada
  /** Chamada a cada mensagem de grupo já gravada. Nunca lança: erro vai para o log e a próxima mensagem segue. */
  const handleMessage = async (m: AutomationMessage): Promise<void> => {
    try {
      // a mensagem é do próprio bot (acuse, aviso, cobrança): não conta como resposta nem como cliente
      if (bots.has(m.waMessageId)) return;
      // mensagens no grupo interno nunca disparam a automação
      if (await isInternalGroup(m.group.jid)) return;

      if (m.fromTeam) {
        const open = await store.getOpenPending(m.group.id);
        // resposta mais antiga que a demanda (sincronização): não encerra
        if (open && m.sentAt.getTime() >= open.receivedAt.getTime() - 5_000) await closeOpen(open, m.senderName || 'equipe', now());
        return;
      }

      if (!m.isNotify || !m.opensPending) return;
      // chave geral desligada: não abre demanda, não responde nem avisa
      if (!(await isEnabled(m.companyId))) return;
      const rule = await getRule(m.group.id);
      if (!rule || !rule.enabled) return;
      const open = await store.getOpenPending(m.group.id);
      if (open) return void (await bump(open, m));
      await openDemand(m, rule);
    } catch (err) {
      failed(err, '[automation] falha ao processar a mensagem', { group: m.group.jid });
    }
  };

  // ------------------------------------------------------------ cobrança
  const escalate = async (pending: PendingReply, rule: AutomationRule, at: Date): Promise<boolean> => {
    if (!pending.instanceId) {
      logger.warn({ group: pending.groupJid }, '[automation] demanda sem conexão do WhatsApp: cobrança não enviada');
      return false;
    }
    const minutes = Math.floor((at.getTime() - pending.receivedAt.getTime()) / 60_000);
    // quem é marcado nesta cobrança: a etapa (pessoas escolhidas + responsáveis do grupo e do setor) ou, sem etapas, a lista da regra
    const step = stepFor(rule, pending.escalationCount);
    let mentions = step ? [...step.mentionJids] : [...rule.mentionJids];
    if (step && (step.mentionGroupResponsibles || step.mentionSectorResponsibles)) {
      try {
        const who = await store.resolveResponsibles(pending.groupId);
        if (step.mentionGroupResponsibles) mentions.push(...who.group);
        if (step.mentionSectorResponsibles) mentions.push(...who.sector);
      } catch (err) {
        // não impede a cobrança: sai com as pessoas escolhidas
        logger.warn({ err, group: pending.groupJid }, '[automation] falha ao buscar os responsáveis para marcar');
      }
    }
    mentions = [...new Set(mentions)];
    try {
      await sender.send({
        instanceId: pending.instanceId,
        jid: rule.notifyGroupJid,
        text: escalationText({
          minutes,
          group: pending.groupName,
          client: pending.clientName,
          preview: pending.preview,
          link: link(pending.groupId),
          mentions,
        }),
        mentions,
      });
    } catch (err) {
      // não conta como cobrança feita: tenta de novo na próxima verificação
      logger.warn({ err, group: pending.groupJid }, '[automation] falha ao enviar a cobrança');
      return false;
    }
    const count = pending.escalationCount + 1;
    await store.markEscalated(pending.id, count, at);
    try {
      // alert:new, critical
      await store.createAlert({
        companyId: pending.companyId,
        groupId: pending.groupId,
        instanceId: pending.instanceId,
        type: 'no_reply',
        severity: 'critical',
        title: `SEM RESPOSTA há ${formatWait(minutes)} - ${pending.groupName}`,
        description: describe(pending.clientName, pending.preview, pending.messageCount),
      });
    } catch (err) {
      logger.warn({ err, group: pending.groupJid }, '[automation] falha ao criar o alerta crítico');
    }
    await store.log(
      pending.companyId,
      pending.groupId,
      'ESCALATE',
      `cobrança ${count} de ${rule.maxEscalations} (há ${formatWait(minutes)})${step ? ` · marcou ${mentions.length} pessoa(s)` : ''}`,
    );
    return true;
  };

  /** Verificador de cobranças: o estado fica no banco, então um reinício não perde demandas nem cobranças. */
  const checkEscalations = async (): Promise<number> => {
    if (checking) return 0;
    checking = true;
    let sent = 0;
    try {
      const at = now();
      for (const { pending, rule, groupStillPending } of await store.listOpenPending().catch((err) => (failed(err, '[automation] falha ao listar as demandas abertas'), []))) {
        try {
          if (!rule || !rule.enabled) continue;
          // chave geral desligada: as demandas ficam guardadas, sem cobrança
          if (!(await isEnabled(pending.companyId))) continue;
          const age = at.getTime() - pending.receivedAt.getTime();
          // o grupo foi respondido por outro caminho (Marcar como respondida, por exemplo): encerra a demanda
          if (!groupStillPending && age > GRACE_MS) {
            await closeOpen(pending, 'sistema (grupo respondido)', at);
            continue;
          }
          if (pending.escalationCount >= rule.maxEscalations) continue;
          // a 1ª cobrança conta desde a mensagem; as demais, desde a cobrança anterior; cada etapa pode ter o seu tempo
          const since = pending.escalationCount === 0 ? age : at.getTime() - (pending.lastEscalatedAt ?? pending.receivedAt).getTime();
          if (since < waitMinutesFor(rule, pending.escalationCount) * 60_000) continue;
          // fora do horário só cobra com escalateOffHours; senão a cobrança sai quando o expediente abrir
          if (!rule.escalateOffHours && !isBusinessHours(rule, at, await timezoneOf(pending.companyId))) continue;
          if (await escalate(pending, rule, at)) sent++;
        } catch (err) {
          logger.error({ err, group: pending.groupJid }, '[automation] falha ao verificar a demanda');
        }
      }
    } finally {
      checking = false;
    }
    return sent;
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(() => void checkEscalations().catch((err) => logger.error({ err }, '[automation] falha no verificador de cobranças')), checkIntervalMs);
    timer.unref?.();
    // logo depois de subir, confere o que ficou aberto antes do reinício
    firstCheck = setTimeout(() => void checkEscalations().catch((err) => logger.error({ err }, '[automation] falha no verificador de cobranças')), 5_000);
    firstCheck.unref?.();
    logger.info('[automation] verificador de cobranças iniciado');
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    if (firstCheck) clearTimeout(firstCheck);
    for (const t of ackTimers) clearTimeout(t);
    ackTimers.clear();
    timer = null;
    firstCheck = null;
  };

  /** Esquece as regras em memória (a próxima mensagem lê do banco). A equipe vem do cache do worker, sem cópia aqui. */
  const reloadRules = () => {
    ruleCache.clear();
    enabledCache.clear();
    notifyJids = null;
  };

  return { handleMessage, checkEscalations, start, stop, reloadRules, isBotMessage: (id: string | null | undefined) => bots.has(id) };
}

export type AutomationService = ReturnType<typeof createAutomation>;
