import { getContentType, normalizeMessageContent, type WAMessage } from 'baileys';

/** Tipo, extensão e tamanho do arquivo de uma mensagem (sem banco: testável). */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

export const FALLBACK_MIME: Record<string, string> = {
  image: 'image/jpeg',
  audio: 'audio/ogg',
  sticker: 'image/webp',
  video: 'video/mp4',
  document: 'application/octet-stream',
};

/** Extensão do arquivo pelo tipo (ou pelo nome do documento). */
export function mediaExtension(mime: string, fileName?: string | null): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const fromName = fileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return base.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
}

/** Dados do arquivo dentro da mensagem (tipo, tamanho e nome), sem baixar. */
export function mediaInfo(msg: WAMessage) {
  const content = normalizeMessageContent(msg.message);
  const key = getContentType(content);
  if (!content || !key) return null;
  const inner = (content as Record<string, unknown>)[key] as
    | { mimetype?: string | null; fileLength?: unknown; fileName?: string | null; seconds?: number | null }
    | undefined;
  if (!inner || typeof inner !== 'object') return null;
  const size = inner.fileLength == null ? null : Number(inner.fileLength);
  // duração (áudio e vídeo): o WhatsApp manda junto, sem precisar baixar
  const seconds = inner.seconds == null ? null : Number(inner.seconds);
  return {
    mime: inner.mimetype ?? null,
    size: Number.isFinite(size) ? size : null,
    fileName: inner.fileName ?? null,
    seconds: seconds != null && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
  };
}
