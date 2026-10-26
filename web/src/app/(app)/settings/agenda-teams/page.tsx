import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AgendaTeams } from './teams';

/** Organização › Setores da agenda (0097): grupos de pessoas para marcar compromissos de uma vez. */
export default async function AgendaTeamsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: people }, { data: teams }] = await Promise.all([
    supabase.rpc('agenda_people'),
    supabase.from('agenda_teams').select('id, name, agenda_team_members(user_id)').order('name'),
  ]);
  return (
    <AgendaTeams
      people={(people ?? []) as { id: string; name: string; role: string }[]}
      teams={((teams ?? []) as { id: string; name: string; agenda_team_members: { user_id: string }[] }[]).map((t) => ({
        id: t.id,
        name: t.name,
        userIds: t.agenda_team_members.map((m) => m.user_id),
      }))}
    />
  );
}
