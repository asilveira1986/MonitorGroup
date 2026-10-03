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
};

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

    const sock = makeWASocket({
      version: this.version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, // mantém as notificações no celular
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });

    const session: Session = {
      instanceId,
      sock,
      qrAttempts: 0,
      stopped: false,
      queue: Promise.resolve(),
      groupCache: new Map(),
    };
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

    sock.ev.on('group-participants.update', ({ id }) => {
      void sock
        .groupMetadata(id)
        .then((meta) => this.upsertGroup(session, meta))
        .catch(() => {});
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

  private async syncGroups(session: Session) {
    try {
      const groups = await session.sock.groupFetchAllParticipating();
      for (const meta of Object.values(groups)) {
        await this.upsertGroup(session, meta);
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

    const group = await this.getGroup(session, jid);
    if (!group.monitored) {
      // o painel pode ter mudado a configuração; confere no banco antes de ignorar
      session.groupCache.delete(jid);
      const fresh = await this.getGroup(session, jid);
      if (!fresh.monitored) return;
    }

    const fromMe = Boolean(msg.key.fromMe);
    const participant = fromMe ? jidNormalizedUser(session.sock.user?.id) : msg.key.participant ?? null;
    const participantAlt = (msg.key as { participantAlt?: string }).participantAlt ?? null;
    const member = fromMe ? null : await findTeamMember(participant, participantAlt);
    const fromTeam = fromMe || Boolean(member);

    const ts = Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000));
    const senderPhone = phoneFromJid(participant) ?? phoneFromJid(participantAlt);
    const senderName = fromMe ? session.sock.user?.name ?? 'Número conectado' : member?.name ?? msg.pushName ?? null;

    const settings = await getSettings();
    const opensPending = !(settings.ignore_acknowledgements && isAcknowledgement(content.type, content.body));

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
}
