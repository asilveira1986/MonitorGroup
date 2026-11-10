'use server';

import { revalidatePath } from 'next/cache';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { isNature, NATURE_REQUIRED } from '@/lib/agenda-nature';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';


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
  /** tipo do compromisso (0102) */
  typeId: string | null;
  /** ISO do término (0172); vazio = sem término */
  endsAt?: string | null;
  /** particular ou profissional (0168): obrigatório ao criar */
  nature?: 'professional' | 'personal' | null;
  /** repetição: null = não mexe (edição) / não repete (novo); { freq: 'none' } = deixa de repetir */
  repeat: RepeatRule | { freq: 'none' } | null;
  /** numa repetição: só este ou este e os próximos */
  scope?: 'one' | 'following';
};

export type RepeatRule = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;
  weekdays: number[];
  until: string | null;
  count: number | null;
};

/** Novo compromisso (ou edição, com id) com os participantes (0097: save_agenda_event). */
async function save(id: string | null, v: AgendaEventInput): Promise<Result> {
  await requireProfile();
  const title = v.title.trim().replace(/\s+/g, ' ');
  const starts = new Date(v.startsAt);
  if (!title) return { ok: false, error: 'Informe o título do compromisso.' };
  if (Number.isNaN(starts.getTime())) return { ok: false, error: 'Informe a data do compromisso.' };
  if (!id && !isNature(v.nature)) return { ok: false, error: NATURE_REQUIRED };
  const supabase = await createClient();
  const args = {
    p_id: id,
    p_title: title,
    p_notes: v.notes ?? null,
    p_starts_at: starts.toISOString(),
    p_all_day: v.allDay,
    p_people: v.people,
    p_reminders: v.reminders,
    p_type: v.typeId,
    p_repeat: v.repeat,
    p_scope: v.scope ?? 'one',
  };
  const ends = v.endsAt ? new Date(v.endsAt) : null;
  if (ends && Number.isNaN(ends.getTime())) return { ok: false, error: 'Informe o término do compromisso.' };
  let { error } = await supabase.rpc('save_agenda_event', { ...args, p_nature: v.nature ?? null, p_ends_at: ends ? ends.toISOString() : null });
  // banco sem o script 0172 ainda: salva sem o término
  if (error && /p_ends_at|save_agenda_event/.test(error.message) && !/término|particular ou profissional/.test(error.message)) {
    ({ error } = await supabase.rpc('save_agenda_event', { ...args, p_nature: v.nature ?? null }));
  }
  // banco sem o script 0168 ainda: salva como antes (sem a natureza)
  if (error && /p_nature|save_agenda_event/.test(error.message) && !/particular ou profissional/.test(error.message)) {
    ({ error } = await supabase.rpc('save_agenda_event', args));
  }
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

/** Exclui o compromisso; numa repetição, só este ou este e os próximos (0102). */
export async function deleteAgendaEvent(id: string, scope: 'one' | 'following' = 'one'): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_agenda_event', { p_id: id, p_scope: scope });
  revalidatePath('/agenda');
  return result(error);
}
