'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';
import { cn } from '@/lib/format';

export const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export function DashboardFilters({ groups }: { groups: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = params.get('period') ?? '7d';
  const group = params.get('group') ?? '';

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-line bg-surface p-1">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            href={hrefWith('period', p.value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition',
              period === p.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <div className="w-56">
        <Select
          className="h-9 text-xs"
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
  );
}
