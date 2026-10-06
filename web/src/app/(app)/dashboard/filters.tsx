'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';
import { cn } from '@/lib/format';

const DAY_MS = 86_400_000;
const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export function DashboardFilters({
  groups,
  members,
  extra,
  today,
  defaultPeriod = '7d',
}: {
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
  /** hoje (AAAA-MM-DD, no fuso da empresa): limite do seletor de dia */
  today: string;
  defaultPeriod?: string;
  /** ação ao lado do filtro de grupo (ex.: Modo TV) */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawPeriod = params.get('period') ?? defaultPeriod;
  // dia mostrado (um dia só): hoje, ontem ou o escolhido no calendário
  const day =
    rawPeriod === 'today' ? today : rawPeriod === 'yesterday' ? addDays(today, -1) : rawPeriod === 'day' ? (params.get('date') ?? today) : null;
  const period = day === today ? 'today' : day === addDays(today, -1) ? 'yesterday' : rawPeriod;
  const group = params.get('group') ?? '';
  const member = params.get('member') ?? '';

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    return `${pathname}?${next.toString()}`;
  };
  const hrefDayless = (value: string) => {
    const next = new URLSearchParams(params);
    next.delete('date');
    next.set('period', value);
    return `${pathname}?${next.toString()}`;
  };

  /** Link para um dia específico (hoje e ontem usam os atalhos). */
  const hrefDay = (ymd: string) => {
    const next = new URLSearchParams(params);
    next.delete('date');
    if (ymd === today) next.set('period', 'today');
    else if (ymd === addDays(today, -1)) next.set('period', 'yesterday');
    else {
      next.set('period', 'day');
      next.set('date', ymd);
    }
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center gap-2 lg:flex-nowrap',
        // com ação extra, a barra ocupa a linha toda para a ação encostar à direita
        extra ? 'min-[1600px]:w-auto' : 'sm:w-auto',
      )}
    >
      <div className="flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            href={hrefDayless(p.value)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium transition sm:flex-none sm:py-1.5',
              period === p.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      {/* dia a dia: anterior, calendário, próximo */}
      <div className="flex w-full items-center rounded-xl border border-line bg-surface sm:w-auto">
        <Link
          href={hrefDay(addDays(day ?? today, -1))}
          className="flex h-11 w-10 items-center justify-center rounded-l-xl text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-9 sm:w-8"
          aria-label="Dia anterior"
          title="Dia anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <input
          type="date"
          max={today}
          value={day ?? ''}
          onChange={(e) => e.target.value && router.push(hrefDay(e.target.value))}
          className={cn(
            'h-11 min-w-0 flex-1 border-x border-line bg-transparent px-2 text-center text-xs tabular-nums text-ink outline-none sm:h-9 sm:w-[8.5rem] sm:flex-none',
            !day && 'text-muted',
          )}
          aria-label="Escolher um dia"
          title="Escolher um dia para analisar"
        />
        {day && day < today ? (
          <Link
            href={hrefDay(addDays(day, 1))}
            className="flex h-11 w-10 items-center justify-center rounded-r-xl text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-9 sm:w-8"
            aria-label="Próximo dia"
            title="Próximo dia"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className="flex h-11 w-10 items-center justify-center text-muted/40 sm:h-9 sm:w-8" aria-hidden>
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-52 sm:flex-none xl:w-56">
          <Select
            className="sm:h-9 sm:text-xs"
            value={group}
            onChange={(e) => router.push(hrefWith('group', e.target.value))}
            aria-label="Filtrar por grupo"
          >
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {members.length > 0 && (
        <div className="w-full sm:w-44 xl:w-48">
          <Select
            className="sm:h-9 sm:text-xs"
            value={member}
            onChange={(e) => router.push(hrefWith('member', e.target.value))}
            aria-label="Filtrar por atendente"
          >
            <option value="">Todos os atendentes</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {/* ação extra (Modo TV): último item da linha, alinhado à direita */}
      {extra && <div className="flex w-full justify-end sm:ml-auto sm:w-auto">{extra}</div>}
    </div>
  );
}
