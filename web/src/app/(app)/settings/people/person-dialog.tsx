'use client';

import { ChevronRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui';

export type PersonStatus = 'active' | 'inactive' | 'none';

const STATUS: Record<PersonStatus, { label: string; tone: 'good' | 'critical' | 'neutral' }> = {
  active: { label: 'Ativo', tone: 'good' },
  inactive: { label: 'Inativo', tone: 'critical' },
  none: { label: 'Sem acesso ao painel', tone: 'neutral' },
};

/**
 * Uma pessoa na lista de Pessoas: só o nome e se está ativa. Ao clicar abre o painel dela (`children`, montado pela página): os
 * dados, as ações e a lista de telas a que ela tem acesso. `menu` são as ações extras (bloquear, excluir...), no alto do painel.
 */
export function PersonRow({
  name,
  you = false,
  status,
  menu,
  children,
}: {
  name: string;
  you?: boolean;
  status: PersonStatus;
  menu?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Esc fecha o painel, a não ser que haja uma janela por cima dele (editar pessoa, senha gerada...)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) setOpen(false);
    };
    window.addEventListener('keydown', esc);
    // a página de trás não rola enquanto o painel está aberto
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const s = STATUS[status];
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none sm:px-5"
        aria-haspopup="dialog"
        aria-label={`Abrir ${name}`}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {name} {you && <span className="font-normal text-muted">(você)</span>}
        </span>
        <Badge tone={s.tone}>{s.label}</Badge>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        // z-40: as janelas de editar pessoa e senha gerada (z-50) abrem por cima deste painel
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Pessoa: ${name}`}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
              <p className="min-w-0 flex-1 truncate text-base font-semibold">{name}</p>
              <Badge tone={s.tone}>{s.label}</Badge>
              {menu}
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-5 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          </div>
        </div>
      )}
    </li>
  );
}
