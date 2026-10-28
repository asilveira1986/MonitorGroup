import { Boom } from '@hapi/boom';
import makeWASocket, {
  ALL_WA_PATCH_NAMES,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  generateMessageIDV2,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  type AnyMessageContent,
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
import { storeMessageMedia, storePrivateMedia } from './media.js';
import { extractContent, isAcknowledgement, isForwarded, isStickerOrEmoji, isThanksAfterTeam, messageChangeOf, phoneFromJid, quoteOf, quotedAuthor, quotedMessageId, reactionOf } from './text.js';
import { processDemandSignals } from './demands.js';
import { contactName, isPrivateJid, privateEnabled, saveContacts } from './private.js';
import { selfReadIds } from './receipts.js';
import { audioContent } from './audio.js';
import { chooseProfile, isPaired, type MonitorCreds } from './connection-profile.js';

const MAX_QR_ATTEMPTS = 6; // ~2 minutos esperando a leitura do QR code
/** respostas do painel que não saíram neste prazo (WhatsApp desconectado) falham em vez de sair atrasadas */
const OUTBOX_EXPIRE_MS = 10 * 60_000;
const POLL_MS = 3_000;
const HEARTBEAT_MS = 60_000;
// mensagens sem remetente: pede ao celular o reenvio (sob demanda) de tempos em tempos
const RECOVER_SENDERS_MS = 6 * 60 * 60_000;

type Session = {
  /**
   * avisos e demandas das mensagens (regras de alerta, notificações, classificação por IA): em
   * fila própria, na ordem, sem segurar a gravação da próxima mensagem
   */
  sideQueue?: Promise<void>;
  /** revisão cliente × equipe agendada depois de completar remetentes (0081) */
  recalcTimer?: ReturnType<typeof setTimeout> | null;
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
  /** LIDs sem número conhecido: não procura de novo no banco antes de alguns minutos */
  lidMisses?: Map<string, number>;
  lidNames: Map<string, string>;
  /** fotos de perfil dos participantes e do grupo (uma de cada vez) */
  avatars: AvatarQueue;
};

type HistoryImport = {
  queue: Promise<void>;
  imported: number;
  touchedGroups: Set<string>;
  /** mensagens antigas que ganharam o remetente nesta importação (0078) */
  sendersFilled?: number;
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
  // áudio gravado no painel (0074)
  message_type?: string;
  media_path?: string | null;
  media_mime?: string | null;
  voice?: boolean;
  // encaminhar e responder citando o privado (0105)
  media_name?: string | null;
  forwarded?: boolean;
  quoted_private_message_id?: string | null;
};

/** "Encaminhada" no WhatsApp (0105) */
const FORWARDED = { isForwarded: true, forwardingScore: 1 };

/** Conteúdo de um arquivo guardado no Storage, pronto para o WhatsApp (imagem, vídeo, áudio, documento). */
async function mediaContent(type: string, buffer: Buffer, mimetype: string, opts: { caption?: string; fileName?: string | null; voice?: boolean }) {
  if (type === 'image') return { image: buffer, caption: opts.caption, mimetype };
  if (type === 'video') return { video: buffer, caption: opts.caption, mimetype };
  if (type === 'audio') return audioContent(buffer, mimetype, Boolean(opts.voice));
  return { document: buffer, mimetype, fileName: opts.fileName ?? 'arquivo', caption: opts.caption };
}

/**
 * Revisão cliente × equipe só dos grupos que mudaram (0084); sem o script, a completa (0076).
 * Uma por empresa de cada vez: pedidos seguidos (várias conexões, contatos, remetentes) se juntam.
 */
const recalcRunning = new Map<string, Promise<{ data: unknown; error: { message: string } | null }>>();
function recalcSenders(companyId: string) {
  const running = recalcRunning.get(companyId);
  if (running) return running;
  const run = (async () => {
    const r = await db.rpc('recalc_company_senders', { p_company_id: companyId });
    if (r.error && /recalc_company_senders/.test(r.error.message)) {
      return await db.rpc('recalc_company_groups', { p_company_id: companyId });
    }
    return r;
  })().finally(() => recalcRunning.delete(companyId));
  recalcRunning.set(companyId, run);
  return run;
}

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
    setInterval(() => {
      for (const s of this.sessions.values()) void this.recoverUnknownSenders(s);
    }, RECOVER_SENDERS_MS);
  }

  status() {
    return [...this.sessions.values()].map((s) => ({ instanceId: s.instanceId, user: s.sock.user?.id ?? null }));
  }

  /** Envia uma mensagem de texto (notificações de alerta) pelo WhatsApp conectado da própria empresa. */
  async sendText(companyId: string, phone: string, text: string) {
    const session = [...this.sessions.values()].find((s) => s.companyId === companyId && s.sock.user && !s.stopped);
    if (!session) throw new Error('nenhum WhatsApp da empresa conectado para enviar a notificação');
    // o número como o WhatsApp conhece (ex.: celular sem o 9 em contas antigas)
    let to = `${phone}@s.whatsapp.net`;
    const [found] = (await session.sock.onWhatsApp(phone).catch(() => [])) ?? [];
    if (found && !found.exists) throw new Error('Este número não tem WhatsApp.');
    if (found?.jid) to = jidNormalizedUser(found.jid);
    await session.sock.sendMessage(to, { text });
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
        } else if (row.requested_action === 'sync_contacts') {
          await this.updateInstance(row.id, { requested_action: null });
          const session = this.sessions.get(row.id);
          if (session?.sock.user) void this.syncContacts(session);
          else await this.updateInstance(row.id, { contacts_sync_status: 'failed' });
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
          // "*": sem o script 0074 as colunas do áudio não existem
          .select('*')
          .maybeSingle();
        if (claimed) await this.sendOutgoing(session, me, claimed as OutgoingRow);
      }
      await this.processMessageActions(session);
      await this.processPrivateOutbox(session, me);
      await this.processPrivateActions(session);
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
      } else if (row.quoted_private_message_id) {
        // "Responder no grupo" (0105): cita a mensagem da conversa privada
        const { data: q } = await db
          .from('private_messages')
          .select('wa_message_id, from_me, body, private_chats!inner(jid)')
          .eq('id', row.quoted_private_message_id)
          .maybeSingle();
        const chatJid = (q as { private_chats?: { jid: string } } | null)?.private_chats?.jid;
        if (q && chatJid) {
          quoted = {
            key: { remoteJid: chatJid, id: q.wa_message_id as string, fromMe: Boolean(q.from_me), participant: q.from_me ? undefined : chatJid },
            message: { conversation: (q.body as string) ?? '' },
          };
        }
      }
      const contextInfo = row.forwarded ? FORWARDED : undefined;

      // registrado antes do envio: a mensagem volta pelo messages.upsert com o nome de quem respondeu
      session.outbox.set(waId, row.sender_name);
      if (row.closes_conversation) session.closingOutbox.add(waId);
      if (row.media_path) {
        // áudio gravado no painel (0074) ou arquivo encaminhado (0105): está no Storage
        const file = await db.storage.from('media').download(row.media_path);
        if (file.error || !file.data) throw new Error('Arquivo não encontrado no Storage.');
        const content = await mediaContent(row.message_type ?? 'audio', Buffer.from(await file.data.arrayBuffer()), row.media_mime ?? 'audio/ogg', {
          caption: row.text_to_send || undefined,
          fileName: row.media_name,
          voice: row.voice,
        });
        await session.sock.sendMessage(group.jid, { ...content, ...(contextInfo ? { contextInfo } : {}) } as AnyMessageContent, { messageId: waId, quoted });
      } else {
        await session.sock.sendMessage(group.jid, { text: row.text_to_send, ...(contextInfo ? { contextInfo } : {}) }, { messageId: waId, quoted });
      }
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
          // fotos dos contatos e das conversas privadas (depois das dos grupos, na mesma fila)
          void this.queueContactPhotos(session).catch((err) => log.warn({ err }, 'fotos dos contatos'));
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
    sock.ev.on('messaging-history.set', ({ messages, contacts, syncType }) => {
      if (contacts?.length) void saveContacts(instanceId, session.companyId, contacts).catch((err) => log.warn({ err }, 'contatos'));
      if (!messages.length) return;
      // resposta ao pedido de mensagens sem remetente (0081): só completa quem enviou
      if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
        void this.fillSendersFromHistory(session, messages).catch((err) => log.warn({ err }, 'falha ao completar remetentes'));
        return;
      }
      this.enqueueHistory(session, messages);
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

    // tiques das mensagens do número conectado: status geral (✓ / ✓✓ / lida) ...
    sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || !key.remoteJid || typeof update.status !== 'number') continue;
        if (isPrivateJid(key.remoteJid)) {
          void db
            .from('private_messages')
            .update({ wa_status: update.status })
            .eq('company_id', session.companyId)
            .eq('wa_message_id', key.id)
            .or(`wa_status.is.null,wa_status.lt.${update.status}`)
            .then(({ error }) => error && log.warn({ err: error.message }, 'status da mensagem privada'));
          continue;
        }
        if (!isJidGroup(key.remoteJid)) continue;
        void this.saveWaStatus(session, key.remoteJid, key.id, update.status).catch((err) =>
          log.warn({ err }, 'falha ao gravar o status da mensagem'),
        );
      }
    });
    // ... e quem recebeu / leu, pessoa a pessoa
    sock.ev.on('message-receipt.update', (list) => {
      for (const { key, receipt } of list) {
        if (!key.fromMe || !key.id || !key.remoteJid || !isJidGroup(key.remoteJid) || !receipt.userJid) continue;
        void this.saveReceipt(session, key.remoteJid, key.id, receipt).catch((err) =>
          log.warn({ err }, 'falha ao gravar a confirmação de leitura'),
        );
      }
    });

    // conversa do grupo apagada no celular
    // foto de perfil (contato ou grupo) mudou: busca de novo
    // contatos do celular (conversas privadas, 0069)
    sock.ev.on('contacts.upsert', (contacts) => {
      void saveContacts(instanceId, session.companyId, contacts).catch((err) => log.warn({ err }, 'contatos'));
    });
    sock.ev.on('contacts.update', (updates) => {
      void saveContacts(instanceId, session.companyId, updates).catch((err) => log.warn({ err }, 'contatos'));
    });
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
      // mensagens sem remetente: pede ao celular o reenvio delas, com quem enviou (0081)
      setTimeout(() => void this.recoverUnknownSenders(session), 90_000);
      // membros atualizados (telefone e LID de cada um): cruza com o cadastro de atendentes e marca
      // como da equipe as mensagens antigas que eram deles (0076), sem segurar a conexão
      void recalcSenders(session.companyId)
        .then(({ data, error }) =>
          error ? logger.warn({ err: error.message }, 'não foi possível revisar as mensagens') : logger.info({ recalc: data }, 'mensagens revisadas: cliente × equipe'),
        );
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
    if (!jid || !msg.message) return;
    if (!isJidGroup(jid)) {
      if (isPrivateJid(jid)) await this.handlePrivateMessage(session, msg, false);
      return;
    }
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

    // avisos (regras de alerta) e demandas (comandos, prazos, classificação por IA) podem demorar
    // (WhatsApp, e-mail, IA): vão para a fila própria da conexão, sem atrasar a próxima mensagem
    const messageId = result.message_id;
    if (result.inserted && !result.stale && messageId) {
      session.sideQueue = (session.sideQueue ?? Promise.resolve())
        .then(async () => {
          if (!fromTeam && !result.ignored) {
            await onClientMessage(session.companyId, { id: group.id, name: group.name }, { id: messageId, body: content.body, senderName });
          }
          await processDemandSignals({
            companyId: session.companyId,
            groupId: group.id,
            groupName: group.name,
            messageId,
            quotedWaId: quotedMessageId(msg.message),
            body: content.body,
            messageType: content.type,
            fromTeam,
            senderName,
            teamMemberId: member?.id ?? null,
            opensPending,
          });
        })
        .catch((err) => logger.error({ err, id: messageId }, 'falha nos avisos/demandas da mensagem'));
    }

    // resposta citando uma mensagem gravada sem remetente: a citação diz quem a escreveu (0080)
    void this.identifyByQuote(session, group.id, msg).catch((err) => logger.warn({ err }, 'falha ao identificar pela citação'));
    // citação para a conversa mostrar como no WhatsApp (0090)
    if (result.inserted && result.message_id) void this.saveQuote(result.message_id, msg);
  }

  /** Guarda a mensagem citada pela resposta (0090; sem o script, a gravação falha calada). */
  private async saveQuote(messageId: string, msg: WAMessage) {
    // encaminhada (0105; sem o script, a gravação falha calada)
    if (isForwarded(msg.message)) await db.from('messages').update({ forwarded: true }).eq('id', messageId);
    const q = quoteOf(msg.message);
    if (!q) return;
    await db
      .from('messages')
      .update({
        quoted_wa_id: q.id,
        quoted_sender_jid: q.participant ? jidNormalizedUser(q.participant) : null,
        quoted_body: q.body,
        quoted_type: q.type,
      })
      .eq('id', messageId);
  }

  /**
   * A mensagem cita outra que foi gravada sem remetente (o WhatsApp não informou): a citação traz
   * o autor da original. Completa o remetente e, se for da equipe (ou o número conectado), passa a
   * mensagem para a equipe e refaz o grupo (0080).
   */
  private async identifyByQuote(session: Session, groupId: string, msg: WAMessage) {
    const quote = quotedAuthor(msg.message);
    if (!quote) return;
    const { data: target } = await db
      .from('messages')
      .select('id')
      .eq('group_id', groupId)
      .eq('wa_message_id', quote.id)
      .is('sender_jid', null)
      .eq('from_me', false)
      .maybeSingle();
    if (!target) return;
    const author = jidNormalizedUser(quote.participant);
    const me = this.isMe(session, author);
    const alt = me ? null : await this.phoneJidForLid(session, msg.key.remoteJid, author);
    const member = me ? null : await findTeamMember(session.companyId, author, alt);
    const { error } = await db.rpc('identify_message_sender', {
      p_message_id: target.id,
      p_jid: author,
      p_phone: phoneFromJid(author) ?? phoneFromJid(alt),
      p_name: me ? (session.sock.user?.name ?? 'Número conectado') : (member?.name ?? session.lidNames.get(author) ?? null),
      p_team_member_id: member?.id ?? null,
      p_team: me || Boolean(member),
    });
    if (error) logger.warn({ err: error.message }, 'não foi possível identificar o remetente pela citação');
    else logger.info({ messageId: target.id, team: me || Boolean(member) }, 'remetente identificado pela citação');
  }

  /**
   * Mensagens gravadas sem remetente (o WhatsApp não informou): pede ao celular conectado o reenvio
   * das mensagens ao redor delas (histórico sob demanda, sem novo QR code). A resposta chega pelo
   * messaging-history.set (ON_DEMAND) e completa quem enviou (fillSendersFromHistory).
   */
  private async recoverUnknownSenders(session: Session) {
    if (session.stopped || !session.sock.user) return;
    const log = logger.child({ instanceId: session.instanceId });
    const { data, error } = await db
      .from('messages')
      .select('id, group_id, sent_at, groups!messages_group_id_fkey!inner(jid, instance_id)')
      .eq('groups.instance_id', session.instanceId)
      .is('sender_jid', null)
      .eq('from_me', false)
      .order('sent_at', { ascending: false })
      .limit(500);
    if (error || !data?.length) return;
    const unknown = data as unknown as { id: string; group_id: string; sent_at: string; groups: { jid: string } }[];
    const covered = new Set<string>();
    let requests = 0;
    for (const u of unknown) {
      if (covered.has(u.id) || requests >= 40 || session.stopped) continue;
      // âncora: a primeira mensagem depois dela com remetente conhecido (o pedido traz as anteriores)
      const { data: anchor } = await db
        .from('messages')
        .select('wa_message_id, from_me, sender_jid, sent_at')
        .eq('group_id', u.group_id)
        .gt('sent_at', u.sent_at)
        .or('sender_jid.not.is.null,from_me.eq.true')
        .order('sent_at')
        .limit(1)
        .maybeSingle();
      if (!anchor) continue; // é a última do grupo: fica para a citação ou o "quem enviou?"
      const { data: before } = await db
        .from('messages')
        .select('id')
        .eq('group_id', u.group_id)
        .lt('sent_at', anchor.sent_at)
        .order('sent_at', { ascending: false })
        .limit(50);
      for (const b of (before ?? []) as { id: string }[]) covered.add(b.id);
      try {
        await session.sock.fetchMessageHistory(
          50,
          { remoteJid: u.groups.jid, id: anchor.wa_message_id as string, fromMe: Boolean(anchor.from_me), participant: (anchor.sender_jid as string | null) ?? undefined },
          new Date(anchor.sent_at as string).getTime(),
        );
        requests++;
      } catch (err) {
        log.warn({ err }, 'o WhatsApp recusou o pedido de mensagens antigas');
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (requests) log.info({ requests, unknown: unknown.length }, 'pedido o reenvio das mensagens sem remetente');
  }

  /** Histórico sob demanda (0081): completa o remetente das mensagens já gravadas sem ele. */
  private async fillSendersFromHistory(session: Session, messages: WAMessage[]) {
    const groups = (check(
      await db.from('groups').select('id, jid').eq('instance_id', session.instanceId),
      'groups for senders',
    ) ?? []) as { id: string; jid: string }[];
    const groupByJid = new Map(groups.map((g) => [g.jid, g.id]));
    const rows: Record<string, unknown>[] = [];
    for (const msg of messages) {
      const groupId = msg.key.remoteJid ? groupByJid.get(msg.key.remoteJid) : undefined;
      if (!groupId || !msg.key.id || msg.key.fromMe || !msg.message) continue;
      const content = extractContent(msg.message);
      if (!content) continue;
      const d = await this.describeMessage(session, msg, content);
      if (d.participant) {
        rows.push({ group_id: groupId, wa_message_id: msg.key.id, jid: d.participant, phone: d.senderPhone, name: d.senderName });
      }
      if (quotedAuthor(msg.message)) await this.identifyByQuote(session, groupId, msg).catch(() => {});
    }
    if (!rows.length) return;
    const { data: filled, error } = await db.rpc('fill_message_senders', { p_rows: rows });
    if (error || !(filled as number)) return;
    logger.info({ filled }, 'remetentes completados pelo reenvio do WhatsApp');
    // revisa cliente × equipe uma vez, depois que as respostas pararem de chegar
    if (session.recalcTimer) clearTimeout(session.recalcTimer);
    session.recalcTimer = setTimeout(() => {
      session.recalcTimer = null;
      void recalcSenders(session.companyId).then(({ error: e }) => {
        if (e) logger.warn({ err: e.message }, 'não foi possível revisar as mensagens');
      });
    }, 30_000);
  }

  /**
   * Reação a uma mensagem (👍 ❤️ ...): uma por pessoa por mensagem. Trocar o emoji substitui,
   * tirar a reação apaga. Não é mensagem: não conta nos tempos nem gera aviso; mas a reação da
   * equipe à mensagem do cliente tira o grupo de "aguardando resposta" (0111).
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
    // reação da equipe a uma mensagem do cliente conta como resposta (0111; sem o script, nada)
    else if (d.fromTeam) {
      const { data: answered } = await db.rpc('answer_by_reaction', { p_message: target.id });
      if (answered) logger.info({ group: group.id }, 'grupo respondido por reação da equipe');
    }
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

  /**
   * Conversa privada (0069): grava a mensagem e a conversa, se o módulo estiver ligado na empresa.
   * Não entra em pendências, SLA, alertas nem indicadores.
   */
  private async handlePrivateMessage(session: Session, msg: WAMessage, fromHistory: boolean) {
    if (!(await privateEnabled(session.companyId))) return;
    const jid = jidNormalizedUser(msg.key.remoteJid!);
    // reação e edição/exclusão feitas no WhatsApp (0070)
    const reaction = reactionOf(msg.message);
    if (reaction) return this.applyPrivateReaction(session, jid, msg, reaction);
    const change = messageChangeOf(msg.message);
    if (change) return this.applyPrivateChange(session, jid, change);
    const content = extractContent(msg.message);
    if (!content || !msg.key.id) return;
    const fromMe = Boolean(msg.key.fromMe);
    // conversa só com o LID (identificador interno): descobre o telefone
    const alt = (msg.key as { remoteJidAlt?: string }).remoteJidAlt;
    const phoneJid = jid.endsWith('@lid') ? (alt ? jidNormalizedUser(alt) : await this.phoneJidForLid(session, null, jid)) : jid;
    const saved = await contactName(session.instanceId, jid);
    const { data: ingested, error } = await db.rpc('ingest_private_message', {
      p_instance_id: session.instanceId,
      p_jid: jid,
      p_phone: phoneFromJid(phoneJid),
      p_name: saved ?? (fromMe ? null : msg.pushName ?? null),
      p_wa_message_id: msg.key.id,
      p_from_me: fromMe,
      p_sender_name: fromMe ? (session.outbox.get(msg.key.id) ?? session.sock.user?.name ?? 'Número conectado') : (msg.pushName ?? saved),
      p_message_type: content.type,
      p_body: content.body,
      p_sent_at: new Date(toSeconds(msg.messageTimestamp) * 1000).toISOString(),
      p_count_unread: !fromHistory,
    });
    if (error) logger.warn({ err: error.message }, 'não foi possível guardar a mensagem privada');
    // imagem/áudio/arquivo: guarda para abrir no painel (em segundo plano)
    const r = ingested as { inserted?: boolean; message_id?: string; chat_id?: string } | null;
    // foto de perfil de quem escreveu (a fila ignora quem já foi visto nos últimos 7 dias)
    if (r?.inserted && !fromHistory && !fromMe) session.avatars.add([jid]);
    // resposta citando outra mensagem (0071)
    const quotedWa = quotedMessageId(msg.message);
    if (r?.inserted && r.message_id && r.chat_id && quotedWa) {
      const { data: q } = await db
        .from('private_messages')
        .select('id')
        .eq('chat_id', r.chat_id)
        .eq('wa_message_id', quotedWa)
        .maybeSingle();
      if (q) await db.from('private_messages').update({ quoted_message_id: q.id }).eq('id', r.message_id);
    }
    if (!fromHistory && r?.inserted && r.message_id && r.chat_id) {
      void storePrivateMedia({
        sock: session.sock,
        msg,
        companyId: session.companyId,
        chatId: r.chat_id,
        messageId: r.message_id,
        type: content.type,
      }).catch((err) => logger.warn({ err }, 'falha ao guardar o arquivo da conversa privada'));
    }
  }

  /** Mensagem privada desta conexão pelo id do WhatsApp (com a conversa). */
  private async privateTarget(session: Session, jid: string, waId: string) {
    const { data } = await db
      .from('private_messages')
      .select('id, chat_id, body, original_body, private_chats!inner(instance_id, jid)')
      .eq('wa_message_id', waId)
      .eq('private_chats.instance_id', session.instanceId)
      .eq('private_chats.jid', jid)
      .maybeSingle();
    return data as { id: string; chat_id: string; body: string | null; original_body: string | null } | null;
  }

  /** Reação recebida (ou retirada) numa conversa privada. */
  private async applyPrivateReaction(session: Session, jid: string, msg: WAMessage, reaction: { targetId: string; emoji: string }) {
    const target = await this.privateTarget(session, jid, reaction.targetId);
    if (!target) return;
    const fromMe = Boolean(msg.key.fromMe);
    const reactor = fromMe ? 'me' : jid;
    if (!reaction.emoji) {
      await db.from('private_reactions').delete().eq('message_id', target.id).eq('reactor_jid', reactor);
      return;
    }
    await db.from('private_reactions').upsert(
      {
        message_id: target.id,
        chat_id: target.chat_id,
        company_id: session.companyId,
        reactor_jid: reactor,
        from_me: fromMe,
        emoji: reaction.emoji,
        reacted_at: new Date(toSeconds(msg.messageTimestamp) * 1000).toISOString(),
      },
      { onConflict: 'message_id,reactor_jid' },
    );
  }

  /** Mensagem privada editada ou apagada no WhatsApp. */
  private async applyPrivateChange(
    session: Session,
    jid: string,
    change: { kind: 'delete'; targetId: string } | { kind: 'edit'; targetId: string; body: string | null },
  ) {
    const target = await this.privateTarget(session, jid, change.targetId);
    if (!target) return;
    const now = new Date().toISOString();
    await db
      .from('private_messages')
      .update(
        change.kind === 'delete'
          ? { deleted_at: now }
          : { body: change.body, edited_at: now, original_body: target.original_body ?? target.body },
      )
      .eq('id', target.id);
    await db.rpc('refresh_private_chat_preview', { p_chat_id: target.chat_id });
  }

  /** Editar, apagar e reagir nas conversas privadas, pedidos no painel (0070). */
  private async processPrivateActions(session: Session) {
    const { data, error } = await db
      .from('private_actions')
      .select('id')
      .eq('instance_id', session.instanceId)
      .eq('status', 'pending')
      .order('created_at')
      .limit(10);
    if (error) return; // sem o script 0070
    for (const { id } of (data ?? []) as { id: string }[]) {
      const { data: row } = await db
        .from('private_actions')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      if (!row) continue;
      try {
        const { data: m } = await db
          .from('private_messages')
          .select('id, chat_id, wa_message_id, from_me, body, original_body, sent_at, private_chats!inner(jid)')
          .eq('id', row.message_id)
          .maybeSingle();
        const jid = (m as { private_chats?: { jid: string } } | null)?.private_chats?.jid;
        if (!m || !jid) throw new Error('Mensagem não encontrada.');
        const key = { remoteJid: jid, id: m.wa_message_id as string, fromMe: Boolean(m.from_me) };
        const now = new Date().toISOString();
        if (row.action === 'edit') {
          // mensagem assinada (0116): o texto novo sai com a mesma assinatura; no painel, sem ela
          await session.sock.sendMessage(jid, { text: ((row.text_to_send as string | null) ?? row.new_body) as string, edit: key });
          await db.from('private_messages').update({ body: row.new_body, edited_at: now, original_body: m.original_body ?? m.body }).eq('id', m.id);
        } else if (row.action === 'delete') {
          await session.sock.sendMessage(jid, { delete: key });
          await db.from('private_messages').update({ deleted_at: now }).eq('id', m.id);
        } else if (row.action === 'delete_me') {
          await session.sock.chatModify(
            { deleteForMe: { deleteMedia: true, key, timestamp: Math.floor(new Date(m.sent_at as string).getTime() / 1000) } },
            jid,
          );
          await db.from('private_messages').update({ hidden_at: now }).eq('id', m.id);
        } else {
          const emoji = (row.emoji as string | null) ?? '';
          await session.sock.sendMessage(jid, { react: { text: emoji, key } });
          if (emoji) {
            await db.from('private_reactions').upsert(
              { message_id: m.id, chat_id: m.chat_id, company_id: session.companyId, reactor_jid: 'me', from_me: true, emoji, reacted_at: now },
              { onConflict: 'message_id,reactor_jid' },
            );
          } else {
            await db.from('private_reactions').delete().eq('message_id', m.id).eq('reactor_jid', 'me');
          }
        }
        if (row.action !== 'react') await db.rpc('refresh_private_chat_preview', { p_chat_id: m.chat_id });
        await db.from('private_actions').update({ status: 'done', error: null, done_at: now }).eq('id', id);
      } catch (err) {
        logger.warn({ err, id }, 'falha na ação da conversa privada');
        await db
          .from('private_actions')
          .update({ status: 'failed', error: err instanceof Error ? err.message : String(err), done_at: new Date().toISOString() })
          .eq('id', id);
      }
    }
  }

  /** Respostas privadas escritas no painel (0069): confere se o número tem WhatsApp e envia. */
  private async processPrivateOutbox(session: Session, me: string) {
    const { data, error } = await db
      .from('private_outgoing')
      .select('id')
      .eq('instance_id', session.instanceId)
      .eq('status', 'pending')
      .order('created_at')
      .limit(10);
    if (error) return; // sem o script 0069
    for (const { id } of (data ?? []) as { id: string }[]) {
      const { data: row } = await db
        .from('private_outgoing')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*, private_chats!inner(id, jid)')
        .maybeSingle();
      if (!row) continue;
      const chat = (row as unknown as { private_chats: { id: string; jid: string } }).private_chats;
      const waId = generateMessageIDV2(me);
      try {
        let to = chat.jid;
        if (to.endsWith('@s.whatsapp.net')) {
          const [found] = (await session.sock.onWhatsApp(to.split('@')[0])) ?? [];
          if (!found?.exists) throw new Error('Este número não tem WhatsApp.');
          to = jidNormalizedUser(found.jid);
        }
        const { data: who } = await db.from('profiles').select('full_name, email').eq('id', row.created_by ?? '').maybeSingle();
        session.outbox.set(waId, (who?.full_name as string) || (who?.email as string) || 'Painel');
        // resposta citando uma mensagem (0071)
        let quoted: WAMessage | undefined;
        if (row.quoted_message_id) {
          const { data: q } = await db
            .from('private_messages')
            .select('wa_message_id, from_me, body')
            .eq('id', row.quoted_message_id)
            .maybeSingle();
          if (q) quoted = { key: { remoteJid: to, id: q.wa_message_id as string, fromMe: Boolean(q.from_me) }, message: { conversation: (q.body as string) ?? '' } };
        }
        // "Responder no privado" (0105): cita a mensagem do grupo
        let quotedFrom: string | null = null;
        if (row.quoted_group_message_id) {
          const { data: q } = await db
            .from('messages')
            .select('wa_message_id, sender_jid, sender_name, from_me, body, groups!messages_group_id_fkey!inner(jid, name)')
            .eq('id', row.quoted_group_message_id)
            .maybeSingle();
          const g = (q as { groups?: { jid: string; name: string } } | null)?.groups;
          if (q && g) {
            quoted = {
              key: { remoteJid: g.jid, id: q.wa_message_id as string, fromMe: Boolean(q.from_me), participant: (q.sender_jid as string | null) ?? undefined },
              message: { conversation: (q.body as string) ?? '' },
            };
            quotedFrom = [g.name, q.sender_name as string | null].filter(Boolean).join(' · ');
          }
        }
        const contextInfo = row.forwarded ? FORWARDED : undefined;
        const type = (row.message_type as string) || 'text';
        let sentSeconds: number | null = null;
        // com a assinatura do usuário (0116), quando houver; sem o script, o texto como foi escrito
        const outText = (row.text_to_send as string | null) ?? (row.body as string | null);
        const caption = outText ?? undefined;
        if (row.media_path) {
          // arquivo enviado pelo painel: está no Storage
          const file = await db.storage.from('media').download(row.media_path as string);
          if (file.error || !file.data) throw new Error('Arquivo não encontrado no Storage.');
          const buffer = Buffer.from(await file.data.arrayBuffer());
          const mimetype = (row.media_mime as string | null) ?? 'application/octet-stream';
          const content = await mediaContent(type, buffer, mimetype, { caption, fileName: row.media_name as string | null, voice: Boolean(row.voice) });
          const sent = await session.sock.sendMessage(to, { ...content, ...(contextInfo ? { contextInfo } : {}) } as AnyMessageContent, { messageId: waId, quoted });
          sentSeconds = Number(sent?.message?.audioMessage?.seconds ?? sent?.message?.videoMessage?.seconds) || null;
        } else {
          await session.sock.sendMessage(to, { text: outText as string, ...(contextInfo ? { contextInfo } : {}) }, { messageId: waId, quoted });
        }
        const now = new Date().toISOString();
        await db.from('private_outgoing').update({ status: 'sent', wa_message_id: waId, sent_at: now, error: null }).eq('id', id);
        // grava já (o eco do WhatsApp com o mesmo id é ignorado)
        const { data: ing } = await db.rpc('ingest_private_message', {
          p_instance_id: session.instanceId,
          p_jid: chat.jid,
          p_phone: phoneFromJid(to),
          p_name: null,
          p_wa_message_id: waId,
          p_from_me: true,
          p_sender_name: session.outbox.get(waId) ?? 'Painel',
          p_message_type: type,
          p_body: type === 'document' && !row.body ? row.media_name : row.body,
          p_sent_at: now,
          p_count_unread: false,
        });
        // o arquivo enviado e a citação já ficam na mensagem gravada
        const sentId = (ing as { message_id?: string } | null)?.message_id;
        // encaminhada e citação de um grupo (0105), à parte (sem o script, a mensagem fica sem isso)
        if (sentId && (row.forwarded || quotedFrom)) {
          await db
            .from('private_messages')
            .update({ forwarded: Boolean(row.forwarded), ...(quotedFrom ? { quoted_body: (quoted?.message?.conversation as string) ?? null, quoted_from: quotedFrom } : {}) })
            .eq('id', sentId);
        }
        if (sentId && (row.media_path || row.quoted_message_id)) {
          await db
            .from('private_messages')
            .update({
              ...(row.media_path ? { media_path: row.media_path, media_mime: row.media_mime, media_status: 'stored' } : {}),
              ...(row.quoted_message_id ? { quoted_message_id: row.quoted_message_id } : {}),
            })
            .eq('id', sentId);
          // duração do áudio enviado (0088), à parte
          if (sentSeconds) await db.from('private_messages').update({ media_seconds: Math.round(sentSeconds) }).eq('id', sentId);
        }
        setTimeout(() => session.outbox.delete(waId), 10 * 60_000);
      } catch (err) {
        session.outbox.delete(waId);
        logger.warn({ err, id }, 'falha ao enviar mensagem privada');
        await db
          .from('private_outgoing')
          .update({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
          .eq('id', id);
      }
    }
  }

  /**
   * Fotos de perfil dos contatos (0113): as conversas privadas (as mais recentes primeiro) e a agenda
   * do WhatsApp entram na fila das fotos, que só busca quem não foi visto nos últimos 7 dias.
   */
  private async queueContactPhotos(session: Session) {
    if (!(await privateEnabled(session.companyId))) return;
    const [{ data: chats }, { data: contacts }] = await Promise.all([
      db
        .from('private_chats')
        .select('jid')
        .eq('instance_id', session.instanceId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1000),
      db.from('wa_contacts').select('jid').eq('instance_id', session.instanceId).not('name', 'is', null).limit(5000),
    ]);
    session.avatars.add([...(chats ?? []), ...(contacts ?? [])].map((r) => r.jid as string));
  }

  /**
   * "Sincronizar contatos" (0072): pede ao WhatsApp o reenvio completo dos dados sincronizados
   * (a agenda chega pelos eventos contacts.upsert, com os nomes salvos) e completa com os membros
   * de todos os grupos do número (nome que usam no WhatsApp, telefone e LID).
   */
  private async syncContacts(session: Session) {
    const log = logger.child({ instanceId: session.instanceId });
    try {
      if (!(await privateEnabled(session.companyId))) throw new Error('conversas privadas desligadas na empresa');
      try {
        // a agenda (com os nomes salvos) fica na coleção critical_unblock_low. Sem apagar a versão
        // guardada, o WhatsApp só manda as mudanças desde a última vez (e a agenda inteira veio uma
        // vez só, no pareamento); sem versão, ele manda a coleção completa de novo
        await session.sock.authState.keys.set({ 'app-state-sync-version': { critical_unblock_low: null } });
        await session.sock.resyncAppState(['critical_unblock_low'], true);
        await session.sock.resyncAppState(ALL_WA_PATCH_NAMES.filter((n) => n !== 'critical_unblock_low'), false);
      } catch (err) {
        log.warn({ err }, 'o WhatsApp não reenviou a agenda (segue com os membros dos grupos)');
      }
      // membros de todos os grupos do número: telefone, LID e o nome conhecido
      const groups = await session.sock.groupFetchAllParticipating();
      const { data: known } = await db
        .from('group_participants')
        .select('jid, name, groups!inner(instance_id)')
        .eq('groups.instance_id', session.instanceId)
        .not('name', 'is', null);
      const nameOf = new Map(((known ?? []) as { jid: string; name: string }[]).map((r) => [r.jid, r.name]));
      const people = new Map<string, { id: string; lid?: string; phoneNumber?: string; notify?: string }>();
      for (const g of Object.values(groups)) {
        for (const p of g.participants ?? []) {
          if (this.isMe(session, p.id)) continue;
          const notify = p.notify ?? nameOf.get(p.id) ?? undefined;
          people.set(p.id, { id: p.id, lid: p.lid ?? undefined, phoneNumber: p.phoneNumber ?? undefined, notify });
        }
      }
      await saveContacts(session.instanceId, session.companyId, [...people.values()]);
      // dá um tempo para a agenda reenviada terminar de gravar e conta
      await new Promise((r) => setTimeout(r, 8000));
      const { count } = await db.from('wa_contacts').select('jid', { count: 'exact', head: true }).eq('instance_id', session.instanceId);
      await this.updateInstance(session.instanceId, {
        contacts_sync_status: 'done',
        contacts_synced_at: new Date().toISOString(),
        contacts_count: count ?? 0,
      });
      log.info({ contacts: count, groupMembers: people.size }, 'contatos sincronizados sob demanda');
      void this.queueContactPhotos(session).catch((err) => log.warn({ err }, 'fotos dos contatos'));
      // com os números dos LIDs em mãos, revisa de novo quem é cliente e quem é da equipe (0076)
      const { data: recalc, error: recalcError } = await recalcSenders(session.companyId);
      if (recalcError) log.warn({ err: recalcError.message }, 'não foi possível revisar as mensagens');
      else log.info({ recalc }, 'mensagens revisadas: cliente × equipe');
    } catch (err) {
      log.warn({ err }, 'falha ao sincronizar os contatos');
      await this.updateInstance(session.instanceId, { contacts_sync_status: 'failed' }).catch(() => {});
    }
  }

  /** Mensagem do número conectado neste grupo, pelo id do WhatsApp. */
  private async ownMessageId(session: Session, groupJid: string, waId: string): Promise<{ id: string; groupId: string } | null> {
    const group = await this.getGroup(session, groupJid);
    const { data } = await db.from('messages').select('id').eq('group_id', group.id).eq('wa_message_id', waId).maybeSingle();
    return data ? { id: data.id as string, groupId: group.id } : null;
  }

  /** Status geral da mensagem (2 enviada, 3 entregue, 4 lida, 5 reproduzida): só avança. */
  private async saveWaStatus(session: Session, groupJid: string, waId: string, status: number) {
    const target = await this.ownMessageId(session, groupJid, waId);
    if (!target) return;
    await db.from('messages').update({ wa_status: status }).eq('id', target.id).or(`wa_status.is.null,wa_status.lt.${status}`);
  }

  /** Confirmação de uma pessoa: entregue e/ou lida (ouvida conta como lida). */
  private async saveReceipt(
    session: Session,
    groupJid: string,
    waId: string,
    receipt: { userJid?: string | null; receiptTimestamp?: unknown; readTimestamp?: unknown; playedTimestamp?: unknown },
  ) {
    const target = await this.ownMessageId(session, groupJid, waId);
    if (!target || !receipt.userJid || this.isMe(session, receipt.userJid)) return;
    const iso = (t: unknown) => (toSeconds(t) > 0 ? new Date(toSeconds(t) * 1000).toISOString() : null);
    const read = iso(receipt.readTimestamp) ?? iso(receipt.playedTimestamp);
    const row: Record<string, unknown> = {
      message_id: target.id,
      company_id: session.companyId,
      group_id: target.groupId,
      user_jid: jidNormalizedUser(receipt.userJid),
    };
    const delivered = iso(receipt.receiptTimestamp) ?? read;
    if (delivered) row.delivered_at = delivered;
    if (read) row.read_at = read;
    const { error } = await db.from('message_receipts').upsert(row, { onConflict: 'message_id,user_jid' });
    if (error) logger.warn({ err: error.message }, 'falha ao gravar a confirmação');
  }

  /** Dados comuns de uma mensagem de grupo (remetente, equipe, horário). */
  /** A última mensagem do grupo que conta (da equipe ou do cliente pedindo algo) foi da equipe? */
  /**
   * A mensagem responde (cita) uma mensagem da equipe? Ex.: o cliente responde ao arquivo que a
   * atendente mandou com "Obrigado @Fulana": o assunto está encerrado, mesmo com outra mensagem dele
   * no meio.
   */
  private async quotedIsTeam(session: Session, msg: WAMessage): Promise<boolean> {
    const quote = quotedAuthor(msg.message);
    if (!quote) return false;
    if (this.isMe(session, quote.participant)) return true;
    const group = msg.key.remoteJid ? session.groupCache.get(msg.key.remoteJid) : undefined;
    if (group) {
      const { data } = await db.from('messages').select('from_team').eq('group_id', group.id).eq('wa_message_id', quote.id).maybeSingle();
      if (data) return Boolean(data.from_team);
    }
    return Boolean(await findTeamMember(session.companyId, quote.participant, null));
  }

  private async lastWasTeam(session: Session, msg: WAMessage): Promise<boolean> {
    const group = msg.key.remoteJid ? session.groupCache.get(msg.key.remoteJid) : undefined;
    if (!group) return false;
    const { data } = await db
      .from('messages')
      .select('from_team')
      .eq('group_id', group.id)
      .eq('ignored_as_last', false)
      // pula os agradecimentos anteriores do cliente ("ok" e depois "obrigada"): contam como encerrados
      .or('from_team.eq.true,opens_pending.eq.true')
      .lt('sent_at', new Date(toSeconds(msg.messageTimestamp) * 1000).toISOString())
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return Boolean(data?.from_team);
  }

  /**
   * Telefone (como jid @s.whatsapp.net) de quem aparece só pelo LID: primeiro o próprio WhatsApp
   * (relação LID → número guardada pela conexão), depois a lista de membros do grupo.
   */
  private async phoneJidForLid(session: Session, groupJid: string | null | undefined, jid: string | null): Promise<string | null> {
    if (!jid || !jid.endsWith('@lid')) return null;
    const known = session.lidPhones.get(jid);
    if (known) return known;
    // sem número da última vez: só o próprio WhatsApp (em memória) por alguns minutos, sem ir ao banco
    const missAt = session.lidMisses?.get(jid);
    const recentMiss = Boolean(missAt && Date.now() - missAt < 5 * 60_000);
    let phoneJid: string | null = null;
    try {
      const pn = await (
        session.sock as unknown as { signalRepository?: { lidMapping?: { getPNForLID(l: string): Promise<string | null> } } }
      ).signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) phoneJid = jidNormalizedUser(pn);
    } catch {
      /* sem a relação no aparelho */
    }
    if (!phoneJid && groupJid && !recentMiss) {
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
    if (!phoneJid && !recentMiss) {
      // contatos do WhatsApp (0069/0073): a agenda e os membros de todos os grupos guardam o LID com o número
      const { data } = await db
        .from('wa_contacts')
        .select('phone')
        .eq('instance_id', session.instanceId)
        .or(`jid.eq.${jid},lid.eq.${jid}`)
        .not('phone', 'is', null)
        .limit(1)
        .maybeSingle();
      if (data?.phone) phoneJid = `${data.phone}@s.whatsapp.net`;
    }
    // só guarda o que achou: sem número, tenta de novo quando a lista de membros for atualizada
    if (phoneJid) {
      session.lidPhones.set(jid, phoneJid);
      session.lidMisses?.delete(jid);
    } else {
      (session.lidMisses ??= new Map()).set(jid, Date.now());
    }
    return phoneJid;
  }

  private async describeMessage(session: Session, msg: WAMessage, content: { type: string; body: string | null }) {
    const fromMe = Boolean(msg.key.fromMe);
    // o remetente costuma vir em key.participant; mensagens reenviadas depois de falha na decodificação
    // e parte do histórico o trazem só em msg.participant ou em key.participantAlt (0078)
    const keyAlt = (msg.key as { participantAlt?: string }).participantAlt ?? null;
    const participant = fromMe
      ? jidNormalizedUser(session.sock.user?.id)
      : (msg.key.participant || msg.participant || keyAlt || null);
    if (!fromMe && !participant && msg.key.remoteJid?.endsWith('@g.us')) {
      logger.warn({ id: msg.key.id, group: msg.key.remoteJid }, 'mensagem de grupo sem remetente');
    }
    // remetente só com LID (identificador interno, sem o número): descobre o telefone para
    // reconhecer a equipe e mostrar nome/telefone na conversa
    const participantAlt =
      (keyAlt && keyAlt !== participant ? keyAlt : null) ??
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
        settings.ignore_acknowledgements &&
        (isAcknowledgement(content.type, content.body, settings.ignore_phrases) ||
          // agradecimento/confirmação logo depois da equipe: encerra o assunto (só volta a pedir
          // resposta se vier pergunta, pedido ou dúvida)
          (!fromMe &&
            !member &&
            isThanksAfterTeam(content.type, content.body) &&
            // respondendo (citando) uma mensagem da equipe, ou logo depois da equipe
            ((await this.quotedIsTeam(session, msg)) || (await this.lastWasTeam(session, msg)))))
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

    // conversas privadas do período (0069; só com o módulo ligado na empresa)
    const privates = messages.filter((m) => isPrivateJid(m.key.remoteJid) && m.message && toSeconds(m.messageTimestamp) >= cutoff);
    if (privates.length && (await privateEnabled(session.companyId))) {
      for (const m of privates) await this.handlePrivateMessage(session, m, true);
      logger.info({ messages: privates.length }, 'histórico das conversas privadas importado');
    }

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
    // citações das respostas importadas (0090)
    for (const msg of messages) {
      const groupId = msg.key.remoteJid ? groupByJid.get(msg.key.remoteJid) : undefined;
      if (!groupId || !msg.key.id || !quoteOf(msg.message)) continue;
      const { data: row } = await db.from('messages').select('id').eq('group_id', groupId).eq('wa_message_id', msg.key.id).maybeSingle();
      if (row) await this.saveQuote(row.id as string, msg);
    }
    // respostas citando mensagens gravadas sem remetente: a citação diz quem as escreveu (0080)
    for (const msg of messages) {
      const groupId = msg.key.remoteJid ? groupByJid.get(msg.key.remoteJid) : undefined;
      if (groupId && quotedAuthor(msg.message)) await this.identifyByQuote(session, groupId, msg).catch(() => {});
    }
    // mensagens já gravadas sem remetente: completa com o que veio agora (0078)
    const senders = rows
      .filter((r) => r.sender_jid && !r.from_me)
      .map((r) => ({ group_id: r.group_id, wa_message_id: r.wa_message_id, jid: r.sender_jid, phone: r.sender_phone, name: r.sender_name }));
    if (senders.length) {
      const { data: filled, error } = await db.rpc('fill_message_senders', { p_rows: senders });
      if (!error && (filled as number) > 0) {
        h.sendersFilled = (h.sendersFilled ?? 0) + (filled as number);
        logger.info({ filled }, 'remetentes completados em mensagens antigas');
      }
    }
    await this.updateInstance(session.instanceId, { history_imported: h.imported });
    logger.info({ instanceId: session.instanceId, total: h.imported }, 'histórico importado (parcial)');
  }

  /** Recalcula tempos de resposta e situação dos grupos que receberam histórico. */
  private async finishHistory(session: Session) {
    const h = session.history;
    if (!h) return;
    session.history = null;
    if (h.sendersFilled) {
      // remetentes completados: revisa quem é cliente e quem é da equipe (0076)
      const { error } = await recalcSenders(session.companyId);
      if (error) logger.warn({ err: error.message }, 'não foi possível revisar as mensagens');
    }
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
