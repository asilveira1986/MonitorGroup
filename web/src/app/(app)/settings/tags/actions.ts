'use server';

import { revalidatePath } from 'next/cache';
import { AGENDA_COLORS } from '@/lib/agenda-colors';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

/** Cria ou atualiza uma etiqueta de clientes (nome e cor) — 0103. */
export async function saveCustomerTag(id: string | null, name: string, color: string): Promise<Result> {
  await requireAdmin();
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'Informe o nome da etiqueta.' };
  if (!(color in AGENDA_COLORS)) return { ok: false, error: 'Escolha uma cor.' };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from('customer_tags').update({ name: clean, color }).eq('id', id)
    : await supabase.rpc('create_customer_tag', { p_name: clean, p_color: color });
  revalidatePath('/settings/tags');
  revalidatePath('/groups', 'layout');
  revalidatePath('/private');
  if (error) return { ok: false, error: /unique|duplicate/i.test(error.message) ? 'Já existe uma etiqueta com esse nome.' : friendlyDbError(error.message) };
  return { ok: true };
}

export async function deleteCustomerTag(id: string): Promise<Result> {
  await requireAdmin();
  const { error } = await (await createClient()).from('customer_tags').delete().eq('id', id);
  revalidatePath('/settings/tags');
  revalidatePath('/groups', 'layout');
  revalidatePath('/private');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
