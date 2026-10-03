import { MessagesSquare, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
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
  const profile = await requireProfile();
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
      .select('*')
      .is('removed_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (q) query = query.ilike('name', `%${q}%`);
    if (filter === 'pending') query = query.eq('monitored', true).not('pending_since', 'is', null);
    if (filter === 'monitored') query = query.eq('monitored', true);
    if (filter === 'ignored') query = query.eq('monitored', false);
    groups = ((await query.limit(500)).data ?? []) as Group[];
  }

  return (
    <>
      <PageHeader title="Grupos" description="Todos os grupos do WhatsApp conectado. Escolha quais devem ser monitorados." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input name="q" defaultValue={q} placeholder="Buscar grupo…" className="pl-9" />
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
        </form>
        <div className="inline-flex overflow-x-auto rounded-xl border border-line bg-surface p-1">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/groups?filter=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium',
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
          <GroupsTable groups={groups} />
        )}
      </Card>
    </>
  );
}
