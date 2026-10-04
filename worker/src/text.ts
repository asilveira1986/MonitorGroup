import { getContentType, normalizeMessageContent, type proto } from 'baileys';

/** Tipos de mensagem que não representam conteúdo real de conversa. */
const IGNORED_TYPES = new Set<string>([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'encReactionMessage',
]);

const TYPE_LABELS: Record<string, string> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  pollCreationMessage: 'poll',
  pollCreationMessageV3: 'poll',
};

export function extractContent(message: proto.IMessage | null | undefined): { type: string; body: string | null } | null {
  const content = normalizeMessageContent(message);
  const type = getContentType(content);
  if (!content || !type || IGNORED_TYPES.has(type)) return null;

  const body =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    content.documentMessage?.fileName ??
    content.pollCreationMessage?.name ??
    content.pollCreationMessageV3?.name ??
    content.contactMessage?.displayName ??
    content.locationMessage?.name ??
    null;

  return { type: TYPE_LABELS[type] ?? type.replace(/Message$/, ''), body: body || null };
}

export const digitsOnly = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

/** "5511999998888@s.whatsapp.net" ou "5511999998888:12@s.whatsapp.net" -> "5511999998888" */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  return digitsOnly(jid.split('@')[0].split(':')[0]) || null;
}

/** Verifica se alguma palavra-chave aparece no texto (sem diferenciar acentos/maiúsculas). */
export function findKeyword(text: string | null, keywords: string[] | null | undefined): string | null {
  if (!text || !keywords?.length) return null;
  const normalized = normalize(text);
  for (const keyword of keywords) {
    const k = normalize(keyword).trim();
    if (!k) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(k)}($|[^\\p{L}\\p{N}])`, 'u');
    if (pattern.test(normalized)) return keyword;
  }
  return null;
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compara telefones tolerando o 9º dígito de celulares brasileiros
 * (ex.: 5511999998888 x 551199998888).
 */
export function samePhone(a: string, b: string): boolean {
  if (a === b) return true;
  const strip9 = (p: string) => (p.startsWith('55') && p.length === 13 ? p.slice(0, 4) + p.slice(5) : p);
  return strip9(a) === strip9(b);
}

const ACKNOWLEDGEMENTS = new Set([
  'ok', 'okay', 'oks', 'okk', 'blz', 'beleza', 'obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu', 'vlw',
  'show', 'top', 'perfeito', 'certo', 'ta bom', 'tá bom', 'tudo bem', 'combinado', 'entendi', 'otimo', 'ótimo',
  'muito obrigado', 'muito obrigada', 'obrigado!', 'de nada', 'sim', 'ok obrigado', 'ok obrigada', 'joia', 'jóia',
]);

/** Mensagem curta de confirmação/agradecimento que não exige resposta. */
export function isAcknowledgement(type: string, body: string | null): boolean {
  if (type === 'sticker') return true;
  if (type !== 'text' || !body) return false;
  const cleaned = body
    .trim()
    .toLowerCase()
    .replace(/[!.,;:?\s]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return false;
  // apenas emojis (👍, 🙏, 😊 ...)
  if (/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u.test(cleaned)) return true;
  return ACKNOWLEDGEMENTS.has(cleaned);
}

/** Id da mensagem citada (quando a mensagem é uma resposta a outra). */
export function quotedMessageId(message: proto.IMessage | null | undefined): string | null {
  const content = normalizeMessageContent(message);
  const type = getContentType(content);
  if (!content || !type) return null;
  const inner = (content as Record<string, unknown>)[type] as { contextInfo?: proto.IContextInfo } | undefined;
  return inner?.contextInfo?.stanzaId ?? null;
}
