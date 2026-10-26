'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const result = (error: { message: string } | null | undefined): Result =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };

export type AgendaEventInput = {
  /** participantes (usuários); vazio = só quem criou */
  people: string[];
  title: string;
  notes?: string | null;
  /** ISO do início (com hora) ou do dia (dia todo) */
  startsAt: string;
  allDay: boolean;
  /** lembretes: minutos antes (0 = na hora; dia todo: antes das 8h do dia) */
  reminders: number[];
};

/** Novo compromisso (ou edição, com id) com os participantes (0097: save_agenda_event). */
async function save(id: string | null, v: AgendaEventInput): Promise<Result> {
  await requireProfile();
  const title = v.title.trim().replace(/\s+/g, ' ');
  const starts = new Date(v.startsAt);
  if (!title) return { ok: false, error: 'Informe o título do compromisso.' };
  if (Number.isNaN(starts.getTime())) return { ok: false, error: 'Informe a data do compromisso.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_agenda_event', {
    p_id: id,
    p_title: title,
    p_notes: v.notes ?? null,
    p_starts_at: starts.toISOString(),
    p_all_day: v.allDay,
    p_people: v.people,
    p_reminders: v.reminders,
  });
  revalidatePath('/agenda');
  revalidatePath('/', 'layout');
  return result(error);
}

export async function createAgendaEvent(values: AgendaEventInput): Promise<Result> {
  return save(null, values);
}

export async function updateAgendaEvent(id: string, values: AgendaEventInput): Promise<Result> {
  return save(id, values);
}

/** Marca (ou desmarca) o compromisso como concluído. */
export async function setAgendaEventDone(id: string, done: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('agenda_events').update({ done_at: done ? new Date().toISOString() : null }).eq('id', id);
  revalidatePath('/agenda');
  return result(error);
}

export async function deleteAgendaEvent(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('agenda_events').delete().eq('id', id);
  revalidatePath('/agenda');
  return result(error);
}
