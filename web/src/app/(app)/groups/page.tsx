import { MessagesSquare, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { GroupSearch } from './group-search';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { cn } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Group } from '@/lib/types';
import { GroupsTable } from './groups-table';
import { RemovedGroups, type RemovedGroup } from './removed-groups';

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Aguardando' },
  { value: 'monitored', label: 'Monitorados' },
  { value: 'ignored', label: 'Ignorados' },
  { value: 'removed', label: 'Excluídos' },
];

export default async function GroupsPage({ searchParams }: PageProps<'/groups'>) {
  const profile = await requireMenu('/groups');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const filter = typeof sp.filter === 'string' ? sp.filter : 'all';

  const supabase = await createClient();
  const { count: removedCount } = await supabase
    .from('groups')
    .select('id', { count: 'exact', head: true })
    .not('removed_at', 'is', null);

  let groups: Group[] = [];
  let removed: RemovedGroup[] = [];

  if (filter === 'removed') {
    let query = supabase
      .from('groups')
      .select('*, messages(count)')
      .not('removed_at', 'is', null)
      .order('removed_at', { ascending: false });
    if (q) query = query.ilike('name', `%${q}%`);
    const { data } = await query.limit(500);
    removed = ((data ?? []) as (Group & { messages: { count: number }[] })[]).map(({ messages, ...g }) => ({
      ...g,
      message_count: messages?.[0]?.count ?? 0,
    }));
  } else {
    let query = supabase
      .from('groups')
      .select('*, sectors(name)')
      .is('removed_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (q) query = query.ilike('name', `%${q}%`);
    if (filter === 'pending') query = query.eq('monitored', true).not('pending_since', 'is', null);
    if (filter === 'monitored') query = query.eq('monitored', true);
    if (filter === 'ignored') query = query.eq('monitored', false);
    const [{ data: rows }, { data: team }] = await Promise.all([query.limit(500), supabase.from('team_members').select('id, name')]);
    const teamName = new Map((team ?? []).map((t) => [t.id as string, t.name as string]));
    groups = ((rows ?? []) as Group[]).map((g) => {
      const ids = g.responsible_member_ids?.length ? g.responsible_member_ids : g.responsible_member_id ? [g.responsible_member_id] : [];
      return { ...g, responsible_names: ids.map((id) => teamName.get(id) ?? 'Responsável') };
    });
  }

  // imagens dos grupos guardadas pelo worker (sem o script 0044, fica sem)
  const { data: photoRows } = await supabase.from('contact_avatars').select('jid').like('jid', '%@g.us').not('path', 'is', null);
  const groupPhotos = (photoRows ?? []).map((r) => r.jid as string);

  return (
    <>
      <PageHeader title="Grupos" description="Todos os grupos do WhatsApp conectado. Escolha quais devem ser monitorados." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <GroupSearch q={q} filter={filter} />
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:flex-nowrap sm:gap-0">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/groups?filter=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium sm:py-1.5',
                filter === f.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
              )}
            >
              {f.label}
              {f.value === 'removed' && (removedCount ?? 0) > 0 && (
                <span className="tabular rounded-full bg-critical px-1.5 text-[10px] font-semibold text-white">
                  {removedCount}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        {filter === 'removed' ? (
          removed.length === 0 ? (
            <EmptyState
              icon={<Trash2 />}
              title="Nenhum grupo excluído"
              description="Quando o número conectado sair de um grupo, for removido ou o grupo for apagado no celular, ele aparece aqui."
            />
          ) : (
            <RemovedGroups groups={removed} isAdmin={profile.role === 'admin'} />
          )
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title="Nenhum grupo encontrado"
            description="Os grupos aparecem automaticamente depois que o WhatsApp é conectado em Configurações > WhatsApp."
          />
        ) : (
          <GroupsTable groups={groups} photos={groupPhotos} />
        )}
      </Card>
    </>
  );
}
