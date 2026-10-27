'use client';

import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { switchCompany } from '@/app/(app)/platform/actions';
import { cn } from '@/lib/format';

export type CompanyOption = { id: string; name: string; active: boolean; hasLogo?: boolean };

/** Logo da empresa (ou o ícone, sem logo). */
export function CompanyLogo({ id, current, hasLogo, name, className }: { id: string; current?: boolean; hasLogo?: boolean; name: string; className?: string }) {
  return hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- logo privado por link temporário
    <img src={current ? '/company-logo' : `/company-logo?id=${id}`} alt={name} className={cn('h-7 w-7 shrink-0 rounded-lg bg-white object-contain p-0.5', className)} />
  ) : (
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-ink-2', className)}>
      <Building2 className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * Troca de empresa (quem administra a plataforma), no rodapé do menu lateral: abre para cima com as
 * empresas, cada uma com o logo, na fonte e nas cores do menu.
 */
export function CompanyMenu({
  companies,
  currentId,
  rowClass,
  hideClass,
}: {
  companies: CompanyOption[];
  currentId: string;
  /** a linha do rodapé (mesmo visual dos outros itens) */
  rowClass: string;
  /** some com o menu recolhido */
  hideClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const current = companies.find((c) => c.id === currentId);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Trocar de empresa"
        title="Trocar de empresa"
        className={cn(rowClass, 'cursor-pointer hover:bg-white/[0.06]', pending && 'opacity-60')}
      >
        <CompanyLogo id={currentId} current hasLogo={current?.hasLogo} name={current?.name ?? ''} />
        <span className={cn('min-w-0 flex-1 truncate text-[calc(0.75rem-1px)] font-semibold leading-tight text-ink', hideClass)}>{current?.name}</span>
        {pending ? (
          <Loader2 className={cn('h-3.5 w-3.5 shrink-0 animate-spin text-muted', hideClass)} aria-hidden />
        ) : (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted transition', open && 'rotate-180', hideClass)} aria-hidden />
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Empresas"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-2xl"
        >
          {companies.map((c) => {
            const selected = c.id === currentId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false);
                    if (selected) return;
                    start(async () => {
                      const res = await switchCompany(c.id);
                      if (res && !res.ok) toast.error(res.error);
                    });
                  }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]', selected && 'bg-white/[0.08] font-semibold')}
                >
                  <CompanyLogo id={c.id} current={selected} hasLogo={c.hasLogo} name={c.name} className="h-6 w-6" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {!c.active && <span className="shrink-0 text-[10px] text-critical-ink">suspensa</span>}
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-text" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
