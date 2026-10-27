'use server';

import { revalidatePath } from 'next/cache';
import { AGENDA_COLORS } from '@/lib/agenda-colors';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

/** Cria ou atualiza um tipo de compromisso (nome e cor) — 0102. */
export async function saveAgendaType(id: string | null, name: string, color: string): Promise<Result> {
  const admin = await requireAdmin();
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'Informe o nome do tipo.' };
  if (!(color in AGENDA_COLORS)) return { ok: false, error: 'Escolha uma cor.' };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from('agenda_event_types').update({ name: clean, color }).eq('id', id)
    : await supabase.from('agenda_event_types').insert({ name: clean, color, company_id: admin.company_id, position: 100 });
  revalidatePath('/settings/agenda-types');
  revalidatePath('/agenda');
  if (error) return { ok: false, error: /unique|duplicate/i.test(error.message) ? 'Já existe um tipo com esse nome.' : friendlyDbError(error.message) };
  return { ok: true };
}

export async function deleteAgendaType(id: string): Promise<Result> {
  await requireAdmin();
  const { error } = await (await createClient()).from('agenda_event_types').delete().eq('id', id);
  revalidatePath('/settings/agenda-types');
  revalidatePath('/agenda');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
