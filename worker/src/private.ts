import type { Contact } from 'baileys';
import { db } from './db.js';
import { logger } from './logger.js';
import { contactRow, isPrivateJid } from './private-jid.js';

/**
 * Conversas privadas (1 a 1) e contatos do WhatsApp conectado (0069).
 * Só gravam nas empresas com o módulo ligado (companies.private_chats_enabled).
 */

const enabledCache = new Map<string, { at: number; on: boolean }>();
/** O módulo de conversas privadas está ligado na empresa? (cache de 60 s; sem o script 0069, não) */
export async function privateEnabled(companyId: string): Promise<boolean> {
  const c = enabledCache.get(companyId);
  if (c && Date.now() - c.at < 60_000) return c.on;
  const { data, error } = await db.from('companies').select('private_chats_enabled').eq('id', companyId).maybeSingle();
  const on = !error && Boolean((data as { private_chats_enabled?: boolean } | null)?.private_chats_enabled);
  enabledCache.set(companyId, { at: Date.now(), on });
  return on;
}

/** Grava/atualiza os contatos sincronizados pelo WhatsApp (em lotes). */
export async function saveContacts(instanceId: string, companyId: string, contacts: Partial<Contact>[]) {
  if (!contacts.length || !(await privateEnabled(companyId))) return;
  const rows = contacts.map((c) => contactRow(instanceId, companyId, c)).filter((r): r is Record<string, unknown> => Boolean(r));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('wa_contacts').upsert(rows.slice(i, i + 500), { onConflict: 'instance_id,jid' });
    if (error) {
      logger.warn({ err: error.message }, 'não foi possível guardar os contatos');
      return;
    }
  }
  logger.info({ contacts: rows.length }, 'contatos sincronizados');
}

/** Nome salvo na agenda (ou o nome que a pessoa usa no WhatsApp) de um contato já sincronizado. */
export async function contactName(instanceId: string, jid: string): Promise<string | null> {
  const { data } = await db.from('wa_contacts').select('name, notify').eq('instance_id', instanceId).eq('jid', jid).maybeSingle();
  return (data?.name as string | null) ?? (data?.notify as string | null) ?? null;
}

export { isPrivateJid };
