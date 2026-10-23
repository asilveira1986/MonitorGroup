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
  // pacotes técnicos/criptografados do WhatsApp, sem texto para mostrar: respostas a Eventos
  // ("vou / não vou"), edições e comentários criptografados, resumo de enquete, marcador de
  // "aguardando esta mensagem" e menção do grupo em status. Antes apareciam como "secretEncrypted".
  'secretEncryptedMessage',
  'encEventResponseMessage',
  'encCommentMessage',
  'pollResultSnapshotMessage',
  'placeholderMessage',
  'statusMentionMessage',
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

/** Reação a uma mensagem: o id da mensagem reagida e o emoji ('' = reação retirada). */
export function reactionOf(message: proto.IMessage | null | undefined): { targetId: string; emoji: string } | null {
  const r = normalizeMessageContent(message)?.reactionMessage;
  const targetId = r?.key?.id;
  if (!r || !targetId) return null;
  return { targetId, emoji: r.text ?? '' };
}

/**
 * Mensagem editada ou apagada no WhatsApp (protocolMessage): o id da mensagem alterada e o novo
 * texto (edição). REVOKE = 0 (apagar para todos), MESSAGE_EDIT = 14.
 */
export function messageChangeOf(
  message: proto.IMessage | null | undefined,
): { kind: 'delete'; targetId: string } | { kind: 'edit'; targetId: string; body: string | null } | null {
  const p = normalizeMessageContent(message)?.protocolMessage;
  const targetId = p?.key?.id;
  if (!p || !targetId) return null;
  if (p.type === 0) return { kind: 'delete', targetId };
  if (p.type === 14) return { kind: 'edit', targetId, body: extractContent(p.editedMessage)?.body ?? null };
  return null;
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

export { isAcknowledgement, isStickerOrEmoji, isThanksAfterTeam } from './acknowledgement.js';

/** Mensagem citada e quem a escreveu (a citação traz o autor da mensagem original). */
export function quotedAuthor(message: proto.IMessage | null | undefined): { id: string; participant: string } | null {
  const content = normalizeMessageContent(message);
  const type = getContentType(content);
  if (!content || !type) return null;
  const ctx = ((content as Record<string, unknown>)[type] as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
  return ctx?.stanzaId && ctx.participant ? { id: ctx.stanzaId, participant: ctx.participant } : null;
}

/** Id da mensagem citada (quando a mensagem é uma resposta a outra). */
export function quotedMessageId(message: proto.IMessage | null | undefined): string | null {
  const content = normalizeMessageContent(message);
  const type = getContentType(content);
  if (!content || !type) return null;
  const inner = (content as Record<string, unknown>)[type] as { contextInfo?: proto.IContextInfo } | undefined;
  return inner?.contextInfo?.stanzaId ?? null;
}
