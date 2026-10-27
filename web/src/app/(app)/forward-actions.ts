'use server';

import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export type ChatKind = 'group' | 'private';

/** Encaminha uma mensagem (do grupo ou do privado) para um grupo ou uma conversa privada (0105). */
export async function forwardMessage(kind: ChatKind, messageId: string, targetKind: ChatKind, targetId: string): Promise<Result<null>> {
  await requireProfile();
  const { error } = await (await createClient()).rpc('forward_message', {
    p_kind: kind,
    p_message: messageId,
    p_target_kind: targetKind,
    p_target: targetId,
  });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, data: null };
}

/** Responde no privado a mensagem de alguém no grupo, citando a mensagem do grupo; devolve a conversa. */
export async function replyPrivately(messageId: string, body: string): Promise<Result<string>> {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc('reply_privately', { p_message: messageId, p_body: body });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, data: data as string };
}

/** Responde num grupo a mensagem de uma conversa privada, citando a mensagem do privado. */
export async function replyInGroup(messageId: string, groupId: string, body: string): Promise<Result<string>> {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc('reply_in_group', { p_message: messageId, p_group: groupId, p_body: body });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, data: data as string };
}
