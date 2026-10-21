'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const result = (error: { message: string } | null | undefined): Result =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };

export type AgendaEventInput = {
  memberId: string;
  title: string;
  notes?: string | null;
  /** ISO do início (com hora) ou do dia (dia todo) */
  startsAt: string;
  allDay: boolean;
};

const clean = (v: AgendaEventInput) => {
  const title = v.title.trim().replace(/\s+/g, ' ');
  const starts = new Date(v.startsAt);
  if (!title) return { error: 'Informe o título do compromisso.' } as const;
  if (Number.isNaN(starts.getTime())) return { error: 'Informe a data do compromisso.' } as const;
  return {
    row: {
      member_id: v.memberId,
      title: title.slice(0, 200),
      notes: v.notes?.trim() ? v.notes.trim().slice(0, 2000) : null,
      starts_at: starts.toISOString(),
      all_day: v.allDay,
    },
  } as const;
};

/** Novo compromisso na agenda (da própria pessoa; administrador: de qualquer pessoa da equipe). */
export async function createAgendaEvent(values: AgendaEventInput): Promise<Result> {
  const profile = await requireProfile();
  const c = clean(values);
  if ('error' in c) return { ok: false, error: c.error! };
  const supabase = await createClient();
  const { error } = await supabase.from('agenda_events').insert({ ...c.row, created_by: profile.id });
  revalidatePath('/agenda');
  return result(error);
}

export async function updateAgendaEvent(id: string, values: AgendaEventInput): Promise<Result> {
  await requireProfile();
  const c = clean(values);
  if ('error' in c) return { ok: false, error: c.error! };
  const supabase = await createClient();
  const { error } = await supabase.from('agenda_events').update(c.row).eq('id', id);
  revalidatePath('/agenda');
  return result(error);
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
