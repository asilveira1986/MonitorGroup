'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

/** Cria ou atualiza um setor da agenda (nome e pessoas) — 0097. */
export async function saveAgendaTeam(id: string | null, name: string, userIds: string[]): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'Informe o nome do setor.' };
  let teamId = id;
  if (teamId) {
    const { error } = await supabase.from('agenda_teams').update({ name: clean }).eq('id', teamId);
    if (error) return { ok: false, error: friendlyDbError(error.message) };
  } else {
    const { data, error } = await supabase.from('agenda_teams').insert({ name: clean, company_id: admin.company_id }).select('id').single();
    if (error) return { ok: false, error: /unique|duplicate/i.test(error.message) ? 'Já existe um setor com esse nome.' : friendlyDbError(error.message) };
    teamId = data.id as string;
  }
  await supabase.from('agenda_team_members').delete().eq('team_id', teamId);
  if (userIds.length) {
    const { error } = await supabase.from('agenda_team_members').insert(userIds.map((u) => ({ team_id: teamId, user_id: u })));
    if (error) return { ok: false, error: friendlyDbError(error.message) };
  }
  revalidatePath('/settings/agenda-teams');
  revalidatePath('/agenda');
  return { ok: true };
}

export async function deleteAgendaTeam(id: string): Promise<Result> {
  await requireAdmin();
  const { error } = await (await createClient()).from('agenda_teams').delete().eq('id', id);
  revalidatePath('/settings/agenda-teams');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
