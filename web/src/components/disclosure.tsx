'use client';

import { Loader2, MoreHorizontal, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { cn } from '@/lib/format';

/** Botão que abre um formulário numa janela (o formulário fica escondido até clicar). */
export function FormDialog({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <Button size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </>
  );
}

export type RowAction = {
  label: string;
  action: () => Promise<{ ok: boolean; error?: string }>;
  success?: string;
  confirm?: string;
  danger?: boolean;
};

/** Menu "⋯" com as ações de uma linha (bloquear, excluir...), em vez de vários botões à vista. */
export function RowMenu({ actions, label = 'Mais ações' }: { actions: RowAction[]; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!actions.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (a.confirm && !window.confirm(a.confirm)) return;
                start(async () => {
                  const res = await a.action();
                  if (!res.ok) return void toast.error(res.error ?? 'Erro ao salvar');
                  if (a.success) toast.success(a.success);
                  router.refresh();
                });
              }}
              className={cn('block w-full px-3 py-2 text-left text-sm hover:bg-surface-2', a.danger ? 'text-critical-ink' : 'text-ink')}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
