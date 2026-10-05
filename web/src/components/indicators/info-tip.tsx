'use client';

import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * Ícone de informação discreto que mostra a legenda do cartão.
 * Abre ao passar o mouse ou ao tocar/clicar (celular); fecha ao sair, com Esc ou clicando fora.
 * O clique não abre o cartão.
 */
export function InfoTip({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`Legenda: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // toque/clique fixa a legenda aberta; clicar de novo fecha
          setOpen(!pinned);
          setPinned(!pinned);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          'rounded-full p-0.5 text-muted/70 transition hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-brand',
          open && 'text-ink-2',
        )}
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] cursor-default rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal leading-relaxed text-ink-2 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
