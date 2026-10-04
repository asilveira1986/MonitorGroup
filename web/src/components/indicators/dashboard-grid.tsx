'use client';

import { ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { getIndicatorDetails } from '@/app/(app)/actions';
import { Card } from '@/components/ui';
import { cn } from '@/lib/format';
import { layoutSpans, type DetailsData, type IndicatorValue } from '@/lib/indicators';
import { DataTable, IndicatorView } from './views';

type Filters = { from: string; to: string; groupId: string | null; memberId: string | null };

function DetailsDrawer({
  indicator,
  filters,
  timeZone,
  onClose,
}: {
  indicator: IndicatorValue;
  filters: Filters;
  timeZone: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<DetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    start(async () => {
      const res = await getIndicatorDetails(indicator.key, filters);
      if (res.ok) setDetails(res.data);
      else setError(res.error);
    });
  }, [indicator.key, filters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={indicator.name}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs text-muted">{indicator.block_name}</p>
            <h2 className="text-lg font-semibold">{indicator.name}</h2>
            {indicator.description && <p className="mt-0.5 text-sm text-ink-2">{indicator.description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          )}
          {error && <p className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical-ink">{error}</p>}
          {details && !loading && (
            <>
              <p className="mb-2 text-xs text-muted">
                {details.rows.length} registro(s){details.rows.length === 500 ? ' (mostrando os 500 mais recentes)' : ''}
              </p>
              <DataTable columns={details.columns} rows={details.rows} timeZone={timeZone} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Blocos e indicadores ativos, na ordem do catálogo. */
export function DashboardGrid({
  indicators,
  filters,
  timeZone,
}: {
  indicators: IndicatorValue[];
  filters: Filters;
  timeZone: string;
}) {
  const [open, setOpen] = useState<IndicatorValue | null>(null);
  const blocks = indicators.reduce<{ key: string; name: string; items: IndicatorValue[] }[]>((acc, ind) => {
    const block = acc.find((b) => b.key === ind.block_key);
    if (block) block.items.push(ind);
    else acc.push({ key: ind.block_key, name: ind.block_name, items: [ind] });
    return acc;
  }, []);

  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <section key={block.key} aria-labelledby={`block-${block.key}`}>
          <h2 id={`block-${block.key}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            {block.name}
          </h2>
          {/* larguras calculadas para fechar cada linha: sem buracos quando indicadores são desligados */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            {block.items.map((ind, idx) => {
              const spans = layoutSpans(block.items.map((i) => i.size));
              const clickable = ind.has_details && ind.data.visual !== 'error';
              return (
                <Card key={ind.key} className={cn('flex flex-col', spans[idx])}>
                  <div
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => setOpen(ind) : undefined}
                    onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && setOpen(ind) : undefined}
                    className={cn(
                      'flex h-full flex-col rounded-2xl p-4 sm:p-5',
                      clickable && 'cursor-pointer transition hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-brand',
                    )}
                    title={clickable ? 'Clique para ver o que compõe este número' : undefined}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{ind.name}</h3>
                        {ind.description && ind.size > 1 && (
                          <p className="mt-0.5 text-xs text-muted">{ind.description}</p>
                        )}
                      </div>
                      {clickable && <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
                    </div>
                    <div className="flex-1">
                      <IndicatorView data={ind.data} name={ind.name} timeZone={timeZone} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
      {open && <DetailsDrawer indicator={open} filters={filters} timeZone={timeZone} onClose={() => setOpen(null)} />}
    </div>
  );
}
