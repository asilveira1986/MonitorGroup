'use client';

import { Building2 } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { switchCompany } from '@/app/(app)/platform/actions';
import { cn } from '@/lib/format';

/**
 * Empresa em que o usuário está, no topo do painel. Quem administra a plataforma
 * troca de empresa por aqui (para configurar ou dar suporte); os demais só veem o nome.
 */
export function CompanySwitcher({
  current,
  companies,
}: {
  current: { id: string; name: string };
  /** só para quem administra a plataforma */
  companies?: { id: string; name: string; active: boolean }[];
}) {
  const [pending, start] = useTransition();
  if (!companies?.length) {
    return (
      <span className="inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink-2">
        <Building2 className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="truncate">{current.name}</span>
      </span>
    );
  }
  return (
    <label className={cn('inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface pl-3 text-sm', pending && 'opacity-60')}>
      <Building2 className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <span className="sr-only">Empresa</span>
      <select
        value={current.id}
        disabled={pending}
        aria-label="Trocar de empresa"
        title="Trocar de empresa (administração da plataforma)"
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            const res = await switchCompany(id);
            if (res && !res.ok) toast.error(res.error);
          });
        }}
        className="h-9 max-w-[16rem] truncate rounded-xl bg-transparent pr-2 text-sm font-medium text-ink outline-none"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.active ? '' : ' (suspensa)'}
          </option>
        ))}
      </select>
    </label>
  );
}
