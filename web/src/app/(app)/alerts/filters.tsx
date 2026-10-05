'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';
import { ALERT_TYPE_LABEL, cn } from '@/lib/format';

const SEVERITIES = [
  { value: '', label: 'Todas' },
  { value: 'critical', label: 'Crítico', dot: 'bg-critical' },
  { value: 'warning', label: 'Atenção', dot: 'bg-warning' },
  { value: 'info', label: 'Informativo', dot: 'bg-series-1' },
];

/** Filtros dos alertas: tipo (lista) e gravidade (botões). */
export function AlertFilters({ types }: { types: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = params.get('type') ?? '';
  const severity = params.get('severity') ?? '';

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-64">
        <Select
          className="sm:h-9 sm:text-xs"
          value={type}
          onChange={(e) => router.push(hrefWith('type', e.target.value))}
          aria-label="Filtrar por tipo de alerta"
        >
          <option value="">Todos os tipos</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {ALERT_TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </Select>
      </div>
      <div
        className="flex w-full rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:w-auto"
        role="group"
        aria-label="Filtrar por gravidade"
      >
        {SEVERITIES.map((s) => (
          <Link
            key={s.value}
            href={hrefWith('severity', s.value)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium sm:flex-none sm:py-1.5',
              severity === s.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
            )}
            aria-current={severity === s.value ? 'true' : undefined}
          >
            {s.dot && <span className={cn('h-2 w-2 rounded-full', s.dot)} aria-hidden />}
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
