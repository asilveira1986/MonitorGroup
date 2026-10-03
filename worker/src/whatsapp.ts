import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { onClientMessage, resolveDisconnectAlerts } from './alerts.js';
import { clearAuthState, hasAuthState, usePostgresAuthState } from './auth-state.js';
import { findTeamMember, getSettings } from './cache.js';
import { check, db, type GroupRow, type InstanceRow } from './db.js';
import { logger } from './logger.js';
import { extractContent, isAcknowledgement, phoneFromJid } from './text.js';

const MAX_QR_ATTEMPTS = 6; // ~2 minutos esperando a leitura do QR code
const POLL_MS = 3_000;
const HEARTBEAT_MS = 60_000;

type Session = {
  instanceId: string;
  sock: WASocket;
  qrAttempts: number;
  stopped: boolean;
  queue: Promise<void>;
  groupCache: Map<string, GroupRow>;
  /** resolvida quando a lista de grupos foi sincronizada (o histórico espera por ela) */
  groupsReady: Promise<void>;
  markGroupsReady: () => void;
  history: HistoryImport | null;
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

const baileysLogger = logger.child({ module: 'baileys' });
baileysLogger.level = process.env.BAILEYS_LOG_LEVEL ?? 'warn';

export class WhatsAppManager {
  private sessions = new Map<string, Session>();
  private reconnectAttempts = new Map<string, number>();
  private version: [number, number, number] | undefined;

  whatsappVersion() {
    return this.version?.join('.') ?? 'padrão da biblioteca';
  }

  async init() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      this.version = version;
    } catch {
      logger.warn('não foi possível obter a versão mais recente do WhatsApp Web; usando padrão');
    }
    logger.info({ version: this.version }, 'versão do WhatsApp Web');

    // Reconecta automaticamente as instâncias que já tinham sessão salva
    const instances = (check(await db.from('whatsapp_instances').select('*'), 'load instances') ?? []) as InstanceRow[];
    for (const inst of instances) {
      if (inst.requested_action) continue; // tratado pelo poll
      if (await hasAuthState(inst.id)) {
        await this.start(inst.id);
      } else if (inst.status !== 'disconnected') {
        await this.updateInstance(inst.id, { status: 'disconnected', qr_code: null });
      }
    }

    setInterval(() => void this.poll(), POLL_MS);
    setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  status() {
    return [...this.sessions.values()].map((s) => ({ instanceId: s.instanceId, user: s.sock.user?.id ?? null }));
  }

  /** Envia uma mensagem de texto (usado para notificações de alerta). */
  async sendText(phone: string, text: string) {
    const session = [...this.sessions.values()].find((s) => s.sock.user);
    if (!session) throw new Error('nenhum WhatsApp conectado para enviar a notificação');
    await session.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
  }

  /** Atende os comandos enviados pelo painel (conectar / desconectar). */
  private async poll() {
    try {
      const rows = (check(await db.from('whatsapp_instances').select('id, requested_action'), 'poll instances') ??
        []) as Pick<InstanceRow, 'id' | 'requested_action'>[];
      const ids = new Set(rows.map((r) => r.id));

      for (const row of rows) {
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
    } catch (err) {
      logger.error({ err }, 'erro ao verificar comandos do painel');
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

    await this.updateInstance(instanceId, { status: 'connecting', last_error: null });
    const { state, saveCreds } = await usePostgresAuthState(instanceId);
    const importHistory = (await getSettings()).history_import_days > 0;

    const sock = makeWASocket({
      version: this.version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      // o histórico completo só é enviado para clientes "Desktop"
      browser: importHistory ? Browsers.macOS('Desktop') : Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, // mantém as notificações no celular
      syncFullHistory: importHistory,
      // com a importação ligada, aceita também o lote "FULL" (o padrão da biblioteca o ignora)
      ...(importHistory ? { shouldSyncHistoryMessage: () => true } : {}),
      generateHighQualityLinkPreview: false,
    });

    const session: Session = {
      instanceId,
      sock,
      qrAttempts: 0,
      stopped: false,
      queue: Promise.resolve(),
      groupCache: new Map(),
      groupsReady: Promise.resolve(),
      markGroupsReady: () => {},
      history: null,
    };
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

          // reconexão com backoff exponencial (restartRequired após o QR é imediato)
          const attempt = (this.reconnectAttempts.get(instanceId) ?? 0) + 1;
          this.reconnectAttempts.set(instanceId, attempt);

          // ainda não pareado (nunca leu o QR) e o WhatsApp recusa repetidamente: para e explica
          if (!state.creds.registered && attempt >= 5 && code !== DisconnectReason.restartRequired) {
            this.reconnectAttempts.delete(instanceId);
            await clearAuthState(instanceId);
            await this.updateInstance(instanceId, {
              status: 'disconnected',
              qr_code: null,
              last_error: `O WhatsApp recusou a conexão ${attempt} vezes (código ${code ?? '?'}: ${reason}). Verifique se o worker tem acesso à internet e tente "Conectar" novamente em alguns minutos.`,
            });
            return;
          }
          const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2_000 * 2 ** (attempt - 1));
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

    // conversa do grupo apagada no celular
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
    const settings = await getSettings();
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
    return row;
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
    const { fromMe, participant, member, fromTeam, senderPhone, senderName, opensPending } = d;
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
      }),
      'ingest_message',
    ) as { inserted: boolean; message_id?: string; stale?: boolean };

    if (result.inserted && !fromTeam && !result.stale && result.message_id) {
      await onClientMessage(
        { id: group.id, name: group.name },
        { id: result.message_id, body: content.body, senderName },
      );
    }
  }

  /** Dados comuns de uma mensagem de grupo (remetente, equipe, horário). */
  private async describeMessage(session: Session, msg: WAMessage, content: { type: string; body: string | null }) {
    const fromMe = Boolean(msg.key.fromMe);
    const participant = fromMe ? jidNormalizedUser(session.sock.user?.id) : (msg.key.participant ?? null);
    const participantAlt = (msg.key as { participantAlt?: string }).participantAlt ?? null;
    const member = fromMe ? null : await findTeamMember(participant, participantAlt);
    const settings = await getSettings();
    return {
      fromMe,
      participant,
      member,
      fromTeam: fromMe || Boolean(member),
      senderPhone: phoneFromJid(participant) ?? phoneFromJid(participantAlt),
      senderName: fromMe ? (session.sock.user?.name ?? 'Número conectado') : (member?.name ?? msg.pushName ?? null),
      sentAtSeconds: toSeconds(msg.messageTimestamp),
      opensPending: !(settings.ignore_acknowledgements && isAcknowledgement(content.type, content.body)),
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
    const settings = await getSettings();
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
        opens_pending: d.opensPending,
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
