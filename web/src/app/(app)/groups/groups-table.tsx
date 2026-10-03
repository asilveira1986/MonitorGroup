import { Hourglass } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { cn, formatNumber, timeAgo } from '@/lib/format';
import type { Group } from '@/lib/types';
import { MonitorToggle } from './group-controls';

export function GroupsTable({ groups }: { groups: Group[] }) {
  return (
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
  );
}
