'use client';

import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn, formatNumber } from '@/lib/format';
import type { HeatmapData } from '@/lib/indicators';

type Point = { label: string; value: number };

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

/** Valor redondo para a linha de referência do gráfico (1, 2, 5, 10, 20, 50…). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Frases-resumo no topo: o que o gestor precisa saber sem ler o gráfico. */
function Highlights({ items }: { items: NonNullable<HeatmapData['highlights']> }) {
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((h) => (
        <div key={h.label} className="rounded-xl bg-surface-2 px-3 py-2.5">
          <dt className="flex items-center gap-1 text-xs text-ink-2">
            {h.label}
            {h.tone === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-warning-ink" aria-label="atenção" />}
          </dt>
          <dd className="mt-0.5 text-base font-semibold leading-tight text-ink sm:text-lg">{h.value}</dd>
          {h.detail && <dd className="mt-0.5 text-xs text-muted">{h.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Mensagens por hora do dia: colunas finas, o expediente sombreado ao fundo e o pico
 * em tom mais forte. Passar o mouse (ou focar) mostra hora, quantidade e percentual.
 */
function HourColumns({
  data,
  total,
  business,
}: {
  data: Point[];
  total: number;
  business?: HeatmapData['business'];
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = niceMax(max);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const inBusiness = (h: number) => !!business && h >= business.start_hour && h < business.end_hour;
  const bandStart = business ? (business.start_hour / 24) * 100 : 0;
  const bandWidth = business ? ((business.end_hour - business.start_hour) / 24) * 100 : 0;
  const shown = active ?? null;

  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">Mensagens por hora do dia</span>
        {business && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-3 w-3 rounded-[3px] bg-brand-soft ring-1 ring-brand/20" aria-hidden />
            horário comercial ({String(business.start_hour).padStart(2, '0')}h–{String(business.end_hour).padStart(2, '0')}h)
          </span>
        )}
      </figcaption>

      <div className="flex gap-2">
        {/* eixo: só o topo e o zero, em cinza discreto */}
        <div className="mt-5 flex h-40 w-7 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-muted">
          <span>{formatNumber(top)}</span>
          <span>{formatNumber(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative mt-5 h-40 flex-1">
          {/* expediente ao fundo */}
          {business && bandWidth > 0 && (
            <div
              className="absolute inset-y-0 rounded-md bg-brand-soft/70"
              style={{ left: `${bandStart}%`, width: `${bandWidth}%` }}
              aria-hidden
            />
          )}
          {/* grade: hairlines discretas */}
          <div className="absolute inset-x-0 top-0 border-t border-line" aria-hidden />
          <div className="absolute inset-x-0 top-1/2 border-t border-line" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 border-t border-line" aria-hidden />

          <div className="relative flex h-full items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
            {data.map((d, i) => {
              const h = (d.value / top) * 100;
              return (
                <button
                  type="button"
                  key={d.label}
                  className="flex h-full flex-1 items-end justify-center outline-none"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  aria-label={`${d.label}: ${d.value} mensagens (${pct(d.value, total)}%)`}
                >
                  <span
                    className={cn(
                      'block w-full max-w-6 rounded-t-[4px] transition-opacity',
                      i === peak ? 'bg-series-1' : inBusiness(i) ? 'bg-series-1/60' : 'bg-series-1/35',
                      shown !== null && shown !== i && 'opacity-50',
                    )}
                    style={{ height: d.value === 0 ? 0 : `max(${h}%, 3px)` }}
                  />
                </button>
              );
            })}
          </div>

          {/* rótulo do pico, sem precisar passar o mouse */}
          {shown === null && data[peak].value > 0 && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-ink"
              style={{
                left: `${((peak + 0.5) / data.length) * 100}%`,
                bottom: `calc(${(data[peak].value / top) * 100}% + 4px)`,
              }}
            >
              pico {data[peak].label}
            </span>
          )}

          {/* dica ao passar o mouse */}
          {shown !== null && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${Math.min(92, Math.max(8, ((shown + 0.5) / data.length) * 100))}%` }}
            >
              <span className="font-semibold text-ink">{data[shown].label}</span>
              <span className="text-ink-2">
                {' '}
                · {formatNumber(data[shown].value)} mensagens · {pct(data[shown].value, total)}%
              </span>
              {business && (
                <span className="block text-muted">{inBusiness(shown) ? 'no expediente' : 'fora do expediente'}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {/* horas a cada 3h */}
      <div className="ml-9 mt-1 flex text-[10px] text-muted">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 text-center">
            {i % 3 === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Dias da semana em barras horizontais, com o valor na ponta e o dia mais movimentado em destaque. */
function DayBars({ data, total, business }: { data: Point[]; total: number; business?: HeatmapData['business'] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  // by_day vem de segunda (índice 0) a domingo (índice 6); dias do expediente usam 0 = domingo
  const isWorkday = (i: number) => !business || business.days.includes((i + 1) % 7);
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium text-ink">Por dia da semana</figcaption>
      <ul className="space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-xs" title={`${d.value} mensagens (${pct(d.value, total)}%)`}>
            <span className={cn('w-8 shrink-0', isWorkday(i) ? 'text-ink-2' : 'text-muted')}>{d.label}</span>
            <span className="relative h-4 flex-1">
              <span
                className={cn('absolute inset-y-0 left-0 rounded-r-[4px]', i === peak ? 'bg-series-1' : 'bg-series-1/45')}
                style={{ width: d.value === 0 ? 0 : `max(${(d.value / max) * 100}%, 3px)` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums text-ink-2">
              <span className={cn(i === peak && 'font-semibold text-ink')}>{formatNumber(d.value)}</span>{' '}
              <span className="text-muted">{pct(d.value, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
      {business && business.days.length < 7 && (
        <p className="mt-2 text-[11px] text-muted">Dias em cinza claro estão fora do expediente.</p>
      )}
    </figure>
  );
}

/** Horários de pico: resumo, por hora, por dia e (recolhido) o mapa completo dia × hora. */
export function PeakHoursView({
  data,
  heatmap,
  compact,
}: {
  data: HeatmapData;
  heatmap: ReactNode;
  /** modo TV: sem o botão do mapa detalhado */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const total = data.total ?? data.by_hour?.reduce((s, d) => s + d.value, 0) ?? 0;
  if (!total) return <p className="py-6 text-center text-sm text-muted">Sem mensagens de clientes no período.</p>;

  return (
    <div className="space-y-5">
      {!!data.highlights?.length && <Highlights items={data.highlights} />}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data.by_hour && <HourColumns data={data.by_hour} total={total} business={data.business} />}
        </div>
        {data.by_day && <DayBars data={data.by_day} total={total} business={data.business} />}
      </div>
      {!compact && (
      <div className="border-t border-line pt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
          aria-expanded={open}
        >
          <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
          {open ? 'Ocultar' : 'Ver'} mapa completo por dia e hora
        </button>
        {open && <div className="mt-3">{heatmap}</div>}
      </div>
      )}
    </div>
  );
}
