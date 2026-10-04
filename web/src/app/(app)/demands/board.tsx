'use client';

import { AlertTriangle, MessageSquareWarning, Plus, Repeat, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DemandDrawer } from '@/components/demands/demand-drawer';
import { DemandForm } from '@/components/demands/demand-form';
import { DemandStatusBadge } from '@/components/demands/status';
import { Button, Card, Input, Select } from '@/components/ui';
import { cn, formatDateTime, timeAgo } from '@/lib/format';
import type { Demand } from '@/lib/types';

export type DemandRow = Demand & { group_name: string; assignee_name: string | null };
type Option = { id: string; name: string };

const TABS = [
  { value: 'open', label: 'Em aberto' },
  { value: 'delivered', label: 'Entregues' },
  { value: 'canceled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
];

function Signals({ d }: { d: DemandRow }) {
  const overdue = d.promised_at && ['aberta', 'em_andamento'].includes(d.status) && new Date(d.promised_at) < new Date();
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {overdue && (
        <span className="inline-flex items-center gap-1 font-medium text-critical-ink">
          <AlertTriangle className="h-3.5 w-3.5" /> prazo vencido
        </span>
      )}
      {d.followups_count > 0 && (
        <span className="inline-flex items-center gap-1 text-warning-ink">
          <MessageSquareWarning className="h-3.5 w-3.5" /> {d.followups_count} cobrança(s)
        </span>
      )}
      {d.reopened_count > 0 && (
        <span className="inline-flex items-center gap-1 text-critical-ink">
          <Repeat className="h-3.5 w-3.5" /> reaberta
        </span>
      )}
      {d.status === 'entregue' && (
        <span className={d.confirmed_at ? 'text-good-ink' : 'text-muted'}>
          {d.confirmed_at ? 'confirmada pelo cliente' : 'sem confirmação'}
        </span>
      )}
    </span>
  );
}

export function DemandsBoard({
  rows,
  groups,
  members,
  types,
  timeZone,
  manualEnabled,
  openCount,
  filters,
}: {
  rows: DemandRow[];
  groups: Option[];
  members: Option[];
  types: string[];
  timeZone: string;
  manualEnabled: boolean;
  openCount: number;
  filters: { status: string; groupId: string | null; assigneeId: string | null; q: string };
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get('id');
  const open = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);

  const go = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:flex-nowrap sm:gap-0">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => go('status', t.value === 'open' ? null : t.value)}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium sm:py-1.5',
                filters.status === t.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
              )}
            >
              {t.label}
              {t.value === 'open' && openCount > 0 && (
                <span className="tabular rounded-full bg-warning px-1.5 text-[10px] font-semibold text-black">{openCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="relative sm:w-56"
            onSubmit={(e) => {
              e.preventDefault();
              go('q', String(new FormData(e.currentTarget).get('q') ?? '').trim() || null);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input name="q" defaultValue={filters.q} placeholder="Buscar demanda…" className="pl-9 sm:h-9 sm:text-xs" />
          </form>
          <Select
            value={filters.groupId ?? ''}
            onChange={(e) => go('group', e.target.value || null)}
            className="sm:h-9 sm:w-48 sm:text-xs"
            aria-label="Filtrar por grupo"
          >
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select
            value={filters.assigneeId ?? ''}
            onChange={(e) => go('assignee', e.target.value || null)}
            className="sm:h-9 sm:w-44 sm:text-xs"
            aria-label="Filtrar por responsável"
          >
            <option value="">Todos os responsáveis</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {manualEnabled && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Nova demanda
            </Button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <Card>
          {/* celular */}
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((d) => (
              <li key={d.id}>
                <button className="block w-full px-4 py-3 text-left hover:bg-surface-2" onClick={() => go('id', d.id)}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 font-medium">
                      <span className="text-muted">#{d.number}</span> {d.description}
                    </span>
                    <DemandStatusBadge status={d.status} />
                  </span>
                  <span className="mt-1 block text-xs text-ink-2" suppressHydrationWarning>
                    {d.group_name} · {d.assignee_name ?? 'sem responsável'} · {timeAgo(d.opened_at)}
                  </span>
                  <span className="mt-1 block">
                    <Signals d={d} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* telas maiores */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-3 py-3 font-medium">Demanda</th>
                  <th className="px-3 py-3 font-medium">Grupo</th>
                  <th className="px-3 py-3 font-medium">Responsável</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Prazo</th>
                  <th className="px-4 py-3 font-medium">Aberta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer border-t border-line align-top hover:bg-surface-2/60" onClick={() => go('id', d.id)}>
                    <td className="tabular px-4 py-3 text-muted">{d.number}</td>
                    <td className="max-w-[340px] px-3 py-3">
                      <p className="line-clamp-2 font-medium">{d.description}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {d.type && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{d.type}</span>}
                        <Signals d={d} />
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-ink-2">{d.group_name}</td>
                    <td className="px-3 py-3 text-ink-2">{d.assignee_name ?? '—'}</td>
                    <td className="px-3 py-3">
                      <DemandStatusBadge status={d.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2">{formatDateTime(d.promised_at, timeZone)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted" suppressHydrationWarning>{timeAgo(d.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {creating && <DemandForm groups={groups} members={members} types={types} onClose={() => setCreating(false)} />}
      {open && (
        <DemandDrawer demand={open} members={members} types={types} timeZone={timeZone} onClose={() => go('id', null)} />
      )}
    </>
  );
}
