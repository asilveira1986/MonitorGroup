import { Hourglass } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { cn, formatNumber, timeAgo } from '@/lib/format';
import type { Group } from '@/lib/types';
import { MonitorToggle } from './group-controls';

function Status({ g }: { g: Group }) {
  if (!g.monitored) return <Badge>Ignorado</Badge>;
  if (g.pending_since)
    return (
      <Badge tone="warning">
        <Hourglass className="h-3 w-3" /> {g.pending_count} aguardando
      </Badge>
    );
  return <Badge tone="good">Em dia</Badge>;
}

export function GroupsTable({ groups }: { groups: Group[] }) {
  return (
    <>
      {/* Celular: cartões */}
      <ul className="divide-y divide-line sm:hidden">
        {groups.map((g) => (
          <li key={g.id} className={cn('flex items-start gap-3 px-4 py-3', !g.monitored && 'opacity-60')}>
            <Link href={`/groups/${g.id}`} className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {g.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">{timeAgo(g.last_message_at)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-ink-2">{g.last_message_preview ?? '—'}</span>
                <span className="mt-1.5 block">
                  <Status g={g} />
                </span>
              </span>
            </Link>
            <div className="pt-2">
              <MonitorToggle groupId={g.id} monitored={g.monitored} />
            </div>
          </li>
        ))}
      </ul>

      {/* Telas maiores: tabela */}
      <div className="hidden overflow-x-auto sm:block">
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
                <Status g={g} />
              </td>
              <td className="px-5 py-3">
                <MonitorToggle groupId={g.id} monitored={g.monitored} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
