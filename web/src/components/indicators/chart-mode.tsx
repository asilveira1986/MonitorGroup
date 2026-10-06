'use client';

import { BarChart3, LineChart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';

export type ChartMode = 'line' | 'bar';

const EVENT = 'chart-mode-change';
const storageKey = (key: string) => `chart-mode:${key}`;

function read(key: string): ChartMode | null {
  try {
    const v = localStorage.getItem(storageKey(key));
    return v === 'line' || v === 'bar' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Escolha de linhas ou barras de um gráfico, guardada neste navegador.
 * null = o formato padrão do indicador. Cartão e tela cheia ficam sincronizados.
 */
export function useChartMode(key: string): [ChartMode | null, (mode: ChartMode) => void] {
  const [mode, setMode] = useState<ChartMode | null>(null);
  useEffect(() => {
    const load = () => setMode(read(key));
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(EVENT, load);
      window.removeEventListener('storage', load);
    };
  }, [key]);
  const change = (next: ChartMode) => {
    try {
      localStorage.setItem(storageKey(key), next);
    } catch {
      /* sem armazenamento local */
    }
    setMode(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return [mode, change];
}

/** Botões discretos "linhas | barras" no canto do cartão. */
export function ChartModeToggle({ mode, onChange }: { mode: ChartMode; onChange: (mode: ChartMode) => void }) {
  const options: { value: ChartMode; label: string; icon: typeof LineChart }[] = [
    { value: 'line', label: 'Linhas', icon: LineChart },
    { value: 'bar', label: 'Barras', icon: BarChart3 },
  ];
  return (
    <div
      role="group"
      aria-label="Tipo de gráfico"
      className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          aria-label={`Mostrar em ${label.toLowerCase()}`}
          title={`Mostrar em ${label.toLowerCase()}`}
          className={cn(
            'rounded-md p-1 transition',
            mode === value ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink-2',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
