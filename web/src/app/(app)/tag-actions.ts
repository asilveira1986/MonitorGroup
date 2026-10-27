'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Etiquetas de clientes (0103): troca as etiquetas de um grupo ou de uma conversa privada. */
export async function setCustomerTags(kind: 'group' | 'private', id: string, tags: string[]): Promise<Result<string[]>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } =
    kind === 'group'
      ? await supabase.rpc('set_group_tags', { p_group: id, p_tags: tags })
      : await supabase.rpc('set_private_chat_tags', { p_chat: id, p_tags: tags });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath(kind === 'group' ? '/groups' : '/private', 'layout');
  return { ok: true, data: (data ?? []) as string[] };
}

/** Nova etiqueta (ou a que já existe com o mesmo nome). */
export async function createCustomerTag(name: string, color: string): Promise<Result<string>> {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc('create_customer_tag', { p_name: name, p_color: color });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, data: data as string };
}
