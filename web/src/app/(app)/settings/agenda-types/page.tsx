import { requireAdmin } from '@/lib/auth';
import type { AgendaType } from '@/lib/agenda-colors';
import { createClient } from '@/lib/supabase/server';
import { AgendaTypes } from './types';

/** Organização › Tipos de compromisso (0102): nome e cor de cada tipo na agenda. */
export default async function AgendaTypesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: types }, { data: used }] = await Promise.all([
    supabase.from('agenda_event_types').select('id, name, color').order('position').order('name'),
    supabase.from('agenda_events').select('type_id').not('type_id', 'is', null).limit(5000),
  ]);
  const count = new Map<string, number>();
  for (const r of (used ?? []) as { type_id: string }[]) count.set(r.type_id, (count.get(r.type_id) ?? 0) + 1);
  return <AgendaTypes types={(types ?? []) as AgendaType[]} usage={Object.fromEntries(count)} />;
}
