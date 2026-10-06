'use client';

import { Loader2, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { getIndicatorDetails } from '@/app/(app)/actions';
import { Card } from '@/components/ui';
import { cn } from '@/lib/format';
import { layoutSpans, type DetailsData, type IndicatorValue, type KpiData } from '@/lib/indicators';
import { InfoTip } from './info-tip';
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

  // tela cheia: a página de trás não rola enquanto a análise está aberta
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={indicator.name}>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="min-w-0">
            <p className="text-xs text-muted">{indicator.block_name}</p>
            <h2 className="text-lg font-semibold sm:text-xl">{indicator.name}</h2>
            {indicator.description && <p className="mt-0.5 text-sm text-ink-2">{indicator.description}</p>}
          </div>
          <button
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" /> <span className="hidden sm:inline">Fechar</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-8 sm:py-6">
          {/* o indicador em tamanho grande */}
          {indicator.data.visual !== 'error' && (
            <Card className="p-4 sm:p-6">
              <IndicatorView data={indicator.data} name={indicator.name} timeZone={timeZone} expanded />
            </Card>
          )}
          {/* o que compõe o número */}
          <Card className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold">O que compõe este indicador</h3>
            {loading && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </p>
            )}
            {error && <p className="mt-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical-ink">{error}</p>}
            {details && !loading && (
              <>
                <p className="mb-2 mt-0.5 text-xs text-muted">
                  {details.rows.length} registro(s)
                  {details.group_by &&
                    ` em ${new Set(details.rows.map((r) => r[details.group_by!.key])).size} grupo(s) · clique no grupo para ver ${details.group_by.noun ? `as ${details.group_by.noun[1]}` : 'os registros'}`}
                  {details.rows.length === 500 ? ' (mostrando os 500 mais recentes)' : ''}
                </p>
                <DataTable columns={details.columns} rows={details.rows} timeZone={timeZone} groupBy={details.group_by} />
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Cartão de um indicador; clicar abre a análise em tela cheia. */
function IndicatorCard({
  ind,
  timeZone,
  onOpen,
  className,
}: {
  ind: IndicatorValue;
  timeZone: string;
  onOpen: (ind: IndicatorValue) => void;
  className?: string;
}) {
  const clickable = ind.has_details && ind.data.visual !== 'error';
  return (
    <Card className={cn('flex flex-col', className)}>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onOpen(ind) : undefined}
        onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onOpen(ind) : undefined}
        className={cn(
          'flex h-full flex-col rounded-2xl p-4 sm:p-5',
          clickable && 'cursor-pointer transition hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:outline-brand',
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold">{ind.name}</h3>
          <InfoTip label={ind.name} className="-mr-1 -mt-0.5 shrink-0">
            <span className="block font-semibold text-ink">{ind.name}</span>
            {ind.description && <span className="mt-1 block">{ind.description}</span>}
            {clickable && <span className="mt-2 block text-muted">Clique no cartão para ver o que compõe o número.</span>}
          </InfoTip>
        </div>
        <div className="flex-1">
          <IndicatorView data={ind.data} name={ind.name} timeZone={timeZone} />
        </div>
      </div>
    </Card>
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
          {/* números numa faixa própria (dividem a largura igualmente) e, abaixo, gráficos e tabelas
              com larguras calculadas para fechar cada linha: nenhum espaço vazio */}
          {(() => {
            const isNumber = (i: IndicatorValue) => i.data.visual === 'kpi' && !(i.data as KpiData).list?.length;
            const numbers = block.items.filter(isNumber);
            const panels = block.items.filter((i) => !isNumber(i));
            const spans = layoutSpans(panels.map((i) => i.size));
            return (
              <div className="space-y-4">
                {numbers.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {numbers.map((ind) => (
                      <IndicatorCard
                        key={ind.key}
                        ind={ind}
                        timeZone={timeZone}
                        onOpen={setOpen}
                        className="min-w-0 flex-[1_1_15rem]"
                      />
                    ))}
                  </div>
                )}
                {panels.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                    {panels.map((ind, idx) => (
                      <IndicatorCard key={ind.key} ind={ind} timeZone={timeZone} onOpen={setOpen} className={spans[idx]} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      ))}
      {open && <DetailsDrawer indicator={open} filters={filters} timeZone={timeZone} onClose={() => setOpen(null)} />}
    </div>
  );
}
