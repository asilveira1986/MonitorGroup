'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';

const KEY = 'dashboard-details-open';

/**
 * Análises detalhadas (os blocos de indicadores do catálogo) abaixo da visão da gestão.
 * Fechadas por padrão para o dashboard ser direto; a escolha fica guardada neste navegador.
 */
export function DetailsSection({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => {
      try {
        setOpen(localStorage.getItem(KEY) === '1');
      } catch {
        // sem acesso ao armazenamento: fica fechado
      }
    };
    load();
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // ignora
    }
  };
  return (
    <section aria-labelledby="analises">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mb-3 flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span id="analises" className="block text-sm font-semibold">
            Análises detalhadas
          </span>
          <span className="block text-xs text-muted">
            {count} indicador(es): acompanhamento do dia, capacidade de resposta, conversas, demandas, relacionamento e contexto
          </span>
        </span>
        <span className="hidden text-xs text-ink-2 sm:inline">{open ? 'Ocultar' : 'Mostrar'}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && children}
    </section>
  );
}
