import { downloadMediaMessage, type WAMessage, type WASocket } from 'baileys';
import { activeCompanyIds, getSettings } from './cache.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { FALLBACK_MIME, mediaExtension, mediaInfo } from './media-info.js';

/**
 * Imagens e áudios no sistema: baixa o arquivo da mensagem do WhatsApp e guarda no
 * Storage do Supabase (bucket privado "media"). O painel abre por link temporário.
 */
export const MEDIA_BUCKET = 'media';
/** acima disso o arquivo não é guardado (fica só o aviso na conversa) */
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
/** tipos que podem ser guardados (cada empresa escolhe quais) */
export const MEDIA_TYPES = ['image', 'audio', 'sticker', 'video', 'document'] as const;
export const DEFAULT_MEDIA_TYPES = ['image', 'audio', 'sticker', 'video', 'document'];

/** Guarda a figura/áudio/arquivo da mensagem, se a empresa estiver guardando esse tipo. */
export async function storeMessageMedia(opts: {
  sock: WASocket;
  msg: WAMessage;
  companyId: string;
  groupId: string;
  messageId: string;
  type: string;
}) {
  return storeMedia(opts, 'messages', `${opts.companyId}/${opts.groupId}`);
}

/** O mesmo para as conversas privadas (0070): pasta <empresa>/private/<conversa>. */
export async function storePrivateMedia(opts: {
  sock: WASocket;
  msg: WAMessage;
  companyId: string;
  chatId: string;
  messageId: string;
  type: string;
}) {
  return storeMedia(opts, 'private_messages', `${opts.companyId}/private/${opts.chatId}`);
}

async function storeMedia(
  opts: { sock: WASocket; msg: WAMessage; companyId: string; messageId: string; type: string },
  table: 'messages' | 'private_messages',
  folder: string,
) {
  const { sock, msg, companyId, messageId, type } = opts;
  // duração do áudio/vídeo (0088), mesmo sem guardar o arquivo; à parte, para um banco sem a
  // coluna não atrapalhar o resto
  const seconds = mediaInfo(msg)?.seconds;
  if (seconds) void db.from(table).update({ media_seconds: seconds }).eq('id', messageId).then(() => {});
  if (!(MEDIA_TYPES as readonly string[]).includes(type)) return;
  const settings = await getSettings(companyId);
  if (settings.media_store_enabled === false) return;
  const types = settings.media_store_types ?? DEFAULT_MEDIA_TYPES;
  if (!types.includes(type)) return;

  const info = mediaInfo(msg);
  const mark = (patch: Record<string, unknown>) => db.from(table).update(patch).eq('id', messageId);

  if (info?.size && info.size > MEDIA_MAX_BYTES) {
    await mark({ media_status: 'too_large', media_size: info.size, media_mime: info.mime });
    return;
  }

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger.child({ module: 'media' }) as never, reuploadRequest: sock.updateMediaMessage },
    );
    if (buffer.length > MEDIA_MAX_BYTES) {
      await mark({ media_status: 'too_large', media_size: buffer.length, media_mime: info?.mime ?? null });
      return;
    }
    const mime = (info?.mime || FALLBACK_MIME[type] || 'application/octet-stream').split(';')[0].trim();
    const path = `${folder}/${messageId}.${mediaExtension(mime, info?.fileName)}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(error.message);
    await mark({ media_path: path, media_mime: mime, media_size: buffer.length, media_status: 'stored' });
  } catch (err) {
    logger.warn({ err, messageId, type }, 'não foi possível guardar o arquivo da mensagem');
    await mark({ media_status: 'failed' });
  }
}

const CLEANUP_BATCH = 200;

/** Apaga os arquivos mais antigos que o prazo de cada empresa (0 = guarda para sempre). */
export async function cleanupExpiredMedia() {
  try {
    for (const companyId of await activeCompanyIds()) {
      const days = Number((await getSettings(companyId)).media_retention_days ?? 90);
      if (!days || days <= 0) continue;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      for (let round = 0; round < 50; round++) {
        const { data, error } = await db
          .from('messages')
          .select('id, media_path, groups!messages_group_id_fkey!inner(company_id)')
          .eq('groups.company_id', companyId)
          .not('media_path', 'is', null)
          .lt('sent_at', cutoff)
          .limit(CLEANUP_BATCH);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { id: string; media_path: string }[];
        if (!rows.length) break;
        const removed = await db.storage.from(MEDIA_BUCKET).remove(rows.map((r) => r.media_path));
        if (removed.error) throw new Error(removed.error.message);
        await db
          .from('messages')
          .update({ media_path: null, media_status: 'expired' })
          .in('id', rows.map((r) => r.id));
        logger.info({ companyId, files: rows.length }, 'arquivos antigos apagados pelo prazo');
        if (rows.length < CLEANUP_BATCH) break;
      }
      // conversas privadas (0070): mesmo prazo
      for (let round = 0; round < 50; round++) {
        const { data, error } = await db
          .from('private_messages')
          .select('id, media_path')
          .eq('company_id', companyId)
          .not('media_path', 'is', null)
          .lt('sent_at', cutoff)
          .limit(CLEANUP_BATCH);
        if (error) break; // sem o script 0070
        const rows = (data ?? []) as { id: string; media_path: string }[];
        if (!rows.length) break;
        const removed = await db.storage.from(MEDIA_BUCKET).remove(rows.map((r) => r.media_path));
        if (removed.error) throw new Error(removed.error.message);
        await db
          .from('private_messages')
          .update({ media_path: null, media_status: 'expired' })
          .in('id', rows.map((r) => r.id));
        if (rows.length < CLEANUP_BATCH) break;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'falha ao apagar arquivos antigos');
  }
}

/**
 * Prazo de guarda das mensagens (LGPD, 0096): passado o prazo de cada empresa, apaga o conteúdo e o
 * remetente das mensagens (fica o registro de que houve a mensagem) e os arquivos delas. Em lotes,
 * para não travar o banco.
 */
export async function applyMessageRetention() {
  try {
    for (const companyId of await activeCompanyIds()) {
      let total = 0;
      for (let round = 0; round < 50; round++) {
        const { data, error } = await db.rpc('apply_message_retention', { p_company_id: companyId, p_limit: 2000 });
        if (error) {
          // banco sem o script 0096: nada a fazer
          if (!/apply_message_retention/.test(error.message)) logger.warn({ err: error.message }, 'prazo de guarda das mensagens');
          return;
        }
        const r = data as { mensagens: number; privadas: number; arquivos: string[] };
        const files = (r.arquivos ?? []).filter(Boolean);
        for (let i = 0; i < files.length; i += 200) {
          await db.storage.from(MEDIA_BUCKET).remove(files.slice(i, i + 200));
        }
        const n = (r.mensagens ?? 0) + (r.privadas ?? 0);
        total += n;
        if (n < 2000) break;
      }
      if (total) logger.info({ companyId, mensagens: total }, 'mensagens apagadas pelo prazo de guarda (LGPD)');
    }
  } catch (err) {
    logger.warn({ err }, 'falha ao aplicar o prazo de guarda das mensagens');
  }
}
