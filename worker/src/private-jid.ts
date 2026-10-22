import { isLidUser, isPnUser, jidNormalizedUser, type Contact } from 'baileys';
import { phoneFromJid } from './text.js';

/** Conversas privadas: identificação dos contatos (sem banco, testável). */

/** Conversa privada com uma pessoa (número ou LID), sem status, canais, robôs etc. */
export const isPrivateJid = (jid: string | null | undefined): jid is string =>
  Boolean(jid && (isPnUser(jid) || isLidUser(jid)));

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
  if (c.name) row.name = c.name;
  if (c.notify ?? c.verifiedName) row.notify = c.notify ?? c.verifiedName;
  return row;
}
