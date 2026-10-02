import { Hourglass, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { cn, formatNumber, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Group } from '@/lib/types';
import { MonitorToggle } from './group-controls';

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Aguardando' },
  { value: 'monitored', label: 'Monitorados' },
  { value: 'ignored', label: 'Ignorados' },
];

export default async function GroupsPage({ searchParams }: PageProps<'/groups'>) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const filter = typeof sp.filter === 'string' ? sp.filter : 'all';

  const supabase = await createClient();
  let query = supabase.from('groups').select('*').order('last_message_at', { ascending: false, nullsFirst: false });
  if (q) query = query.ilike('name', `%${q}%`);
  if (filter === 'pending') query = query.eq('monitored', true).not('pending_since', 'is', null);
  if (filter === 'monitored') query = query.eq('monitored', true);
  if (filter === 'ignored') query = query.eq('monitored', false);
  const { data } = await query.limit(500);
  const groups = (data ?? []) as Group[];

  return (
    <>
      <PageHeader title="Grupos" description="Todos os grupos do WhatsApp conectado. Escolha quais devem ser monitorados." />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input name="q" defaultValue={q} placeholder="Buscar grupo…" className="pl-9" />
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
        </form>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/groups?filter=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium',
                filter === f.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        {groups.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title="Nenhum grupo encontrado"
            description="Os grupos aparecem automaticamente depois que o WhatsApp é conectado em Configurações > WhatsApp."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-5 py-3 font-medium">Grupo</th>
                  <th className="px-3 py-3 font-medium">Última mensagem</th>
                  <th className="px-3 py-3 text-right font-medium">Participantes</th>
                  <th className="px-3 py-3 font-medium">Situação</th>
                  <th className="px-5 py-3 font-medium">Monitorar</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className={cn('border-t border-line', !g.monitored && 'opacity-60')}>
                    <td className="px-5 py-3">
                      <Link href={`/groups/${g.id}`} className="flex items-center gap-3 hover:text-brand">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                          {g.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="max-w-[240px] truncate font-medium">{g.name}</span>
                      </Link>
                    </td>
                    <td className="max-w-[320px] px-3 py-3">
                      <p className="truncate text-ink-2">{g.last_message_preview ?? '—'}</p>
                      <p className="text-xs text-muted">{timeAgo(g.last_message_at)}</p>
                    </td>
                    <td className="tabular px-3 py-3 text-right">{formatNumber(g.participants_count)}</td>
                    <td className="px-3 py-3">
                      {!g.monitored ? (
                        <Badge>Ignorado</Badge>
                      ) : g.pending_since ? (
                        <Badge tone="warning">
                          <Hourglass className="h-3 w-3" /> {g.pending_count} aguardando
                        </Badge>
                      ) : (
                        <Badge tone="good">Em dia</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <MonitorToggle groupId={g.id} monitored={g.monitored} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
