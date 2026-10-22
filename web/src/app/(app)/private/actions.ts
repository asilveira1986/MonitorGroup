'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: { message: string }) => ({ ok: false as const, error: friendlyDbError(e.message) });

/** Abre (ou acha) a conversa com um contato salvo (jid) ou um número novo (phone). */
export async function startPrivateChat(input: { jid?: string; phone?: string; name?: string }): Promise<Result<{ id: string }>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_private_chat', {
    p_jid: input.jid ?? null,
    p_phone: input.phone ?? null,
    p_name: input.name ?? null,
  });
  if (error) return fail(error);
  revalidatePath('/private');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/** Envia pelo número conectado (o worker confere se o número tem WhatsApp). */
export async function sendPrivateMessage(chatId: string, body: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_private_message', { p_chat_id: chatId, p_body: body });
  return error ? fail(error) : { ok: true };
}

export async function markPrivateChatRead(chatId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_private_chat_read', { p_chat_id: chatId });
  return error ? fail(error) : { ok: true };
}
