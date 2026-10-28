import { isLidUser, isPnUser, jidNormalizedUser, type Contact } from 'baileys';
import { phoneFromJid } from './text.js';

/** Conversas privadas: identificação dos contatos (sem banco, testável). */

/** Conversa privada com uma pessoa (número ou LID), sem status, canais, robôs etc. */
export const isPrivateJid = (jid: string | null | undefined): jid is string =>
  Boolean(jid && (isPnUser(jid) || isLidUser(jid)));

/**
 * Nome de verdade, ou null: para contatos só com o identificador interno (LID), o WhatsApp manda como
 * nome o número mascarado (ex.: "+55∙∙∙∙∙∙∙11"); número (mascarado ou não) não é nome.
 */
export function realContactName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  if (!/\p{L}/u.test(n) && /^\+?\d/.test(n) && n.replace(/\D/g, '').length >= 4) return null;
  return n;
}

/** Linha de wa_contacts a partir do contato do WhatsApp (ou null se não for de pessoa). */
export function contactRow(instanceId: string, companyId: string, c: Partial<Contact>) {
  const id = c.id ? jidNormalizedUser(c.id) : null;
  if (!isPrivateJid(id)) return null;
  const pn = c.phoneNumber ? jidNormalizedUser(c.phoneNumber) : isPnUser(id) ? id : null;
  const row: Record<string, unknown> = {
    instance_id: instanceId,
    company_id: companyId,
    jid: id,
    updated_at: new Date().toISOString(),
  };
  const lid = c.lid ?? (isLidUser(id) ? id : null);
  if (lid) row.lid = lid;
  if (pn) row.phone = phoneFromJid(pn);
  const name = realContactName(c.name);
  const notify = realContactName(c.notify ?? c.verifiedName);
  if (name) row.name = name;
  if (notify) row.notify = notify;
  return row;
}
