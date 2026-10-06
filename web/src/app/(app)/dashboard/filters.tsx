'use client';

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
  /** hoje (AAAA-MM-DD, no fuso da empresa): marca Hoje/Ontem quando a URL traz um dia */
  today: string;
  defaultPeriod?: string;
  /** ação ao lado do filtro de grupo (ex.: Modo TV) */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawPeriod = params.get('period') ?? defaultPeriod;
  // dia mostrado (um dia só): hoje, ontem ou um dia vindo da URL (?period=day&date=)
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

  return (
    <div
      className={cn(
        // quebra em duas linhas em telas médias; numa linha só a partir de 1280px
        'flex w-full flex-wrap items-center gap-2 xl:flex-nowrap',
        // com ação extra, a barra ocupa a linha toda para a ação encostar à direita
        extra ? 'min-[1600px]:w-auto' : 'sm:w-auto',
      )}
    >
      <div className="flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto sm:shrink-0">
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
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-60 sm:flex-none xl:w-72">
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
        <div className="w-full sm:w-52 xl:w-60">
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
