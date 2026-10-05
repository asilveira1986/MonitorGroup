'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';
import { cn } from '@/lib/format';

export const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export function DashboardFilters({
  groups,
  members,
  extra,
}: {
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
  /** ação ao lado do filtro de grupo (ex.: Modo TV) */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = params.get('period') ?? '7d';
  const group = params.get('group') ?? '';
  const member = params.get('member') ?? '';

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <div className="flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            href={hrefWith('period', p.value)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium transition sm:flex-none sm:py-1.5',
              period === p.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      {/* grupo e a ação extra (Modo TV) sempre lado a lado */}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
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
        {extra}
      </div>
      {members.length > 0 && (
        <div className="w-full sm:w-48">
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
    </div>
  );
}
