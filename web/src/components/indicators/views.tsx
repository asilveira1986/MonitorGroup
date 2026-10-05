'use client';

import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { BarsChart, Legend, SERIES_COLORS, SeriesChart, TrendSparkline } from '@/components/charts';
import { cn } from '@/lib/format';
import {
  formatValue,
  type Column,
  type HeatmapData,
  type IndicatorData,
  type KpiData,
  type SeriesData,
  type TableData,
} from '@/lib/indicators';

const TONE = {
  good: { cls: 'bg-good/12 text-good-ink', icon: CheckCircle2, label: 'Dentro do esperado' },
  warning: { cls: 'bg-warning/15 text-warning-ink', icon: AlertTriangle, label: 'Atenção' },
  critical: { cls: 'bg-critical/12 text-critical-ink', icon: AlertOctagon, label: 'Crítico' },
};

function KpiView({ data, name }: { data: KpiData; name: string }) {
  const tone = data.tone ? TONE[data.tone] : null;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight">{formatValue(data.value, data.format)}</p>
        {tone && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone.cls)}>
            <tone.icon className="h-3.5 w-3.5" aria-hidden /> {tone.label}
          </span>
        )}
      </div>
      {data.hint && <p className="mt-1 text-xs text-muted">{data.hint}</p>}
      {!!data.secondary?.length && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {data.secondary.map((s) => (
            <div key={s.label} className="flex gap-1.5">
              <dt className="text-muted">{s.label}</dt>
              <dd className="tabular font-medium text-ink">{formatValue(s.value, s.format)}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.trend && (
        <div className="-mx-1 mt-2">
          <TrendSparkline data={data.trend.data} format={data.trend.format} label={data.trend.label ?? name} />
        </div>
      )}
    </div>
  );
}

/** Mini gráfico de barras da evolução (um valor por dia ou semana). */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 6;
  const gap = 2;
  const h = 22;
  return (
    <svg
      width={values.length * (w + gap)}
      height={h}
      className="block"
      role="img"
      aria-label={`Evolução: ${values.join(', ')}`}
    >
      {values.map((v, i) => {
        const bh = v === 0 ? 1 : Math.max(2, (v / max) * h);
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1.5}
            className={v === 0 ? 'fill-line' : v === max ? 'fill-series-1' : 'fill-series-1/45'}
          >
            <title>{v}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function DataTable({
  columns,
  rows,
  timeZone,
  maxRows,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  timeZone?: string;
  maxRows?: number;
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const maxByCol = Object.fromEntries(
    columns.filter((c) => c.bar).map((c) => [c.key, Math.max(1, ...rows.map((r) => Number(r[c.key]) || 0))]),
  );
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">Sem dados no período.</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-2 py-2 font-medium', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {shown.map((row, i) => (
            <tr key={i} className="border-t border-line align-top">
              {columns.map((c) => {
                const raw = row[c.key];
                const text = formatValue(raw, c.format, timeZone);
                const highlighted =
                  c.highlight_abs_gte != null && raw != null && Math.abs(Number(raw)) >= c.highlight_abs_gte;
                const below = c.warn_below != null && raw != null && Number(raw) < c.warn_below;
                return (
                  <td
                    key={c.key}
                    className={cn('px-2 py-2', c.align === 'right' && 'text-right', !c.format && 'max-w-[280px]')}
                  >
                    {c.format === 'spark' ? (
                      Array.isArray(raw) ? <Spark values={raw.map(Number)} /> : '—'
                    ) : c.link_demand && row.demand_id ? (
                      <Link
                        href={`/demands?status=all&id=${row.demand_id}`}
                        className="font-medium text-brand hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{text}
                      </Link>
                    ) : c.link && row[c.link] ? (
                      <Link href={`/groups/${row[c.link]}`} className="font-medium hover:text-brand" onClick={(e) => e.stopPropagation()}>
                        {text}
                      </Link>
                    ) : highlighted ? (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-xs font-semibold',
                          Number(raw) > 0 ? 'bg-series-1/12 text-series-1' : 'bg-critical/12 text-critical-ink',
                        )}
                        title={Number(raw) > 0 ? 'Pico em relação ao período anterior' : 'Queda em relação ao período anterior'}
                      >
                        {Number(raw) > 0 ? '▲ ' : '▼ '}
                        {text}
                      </span>
                    ) : below ? (
                      <span
                        className="rounded-full bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning-ink"
                        title={`Abaixo de ${c.warn_below}`}
                      >
                        {text}
                      </span>
                    ) : (
                      <span className={cn(!c.format && 'line-clamp-2')}>{text}</span>
                    )}
                    {c.bar && (
                      <span className="mt-1 block h-1 rounded-full bg-surface-2">
                        <span
                          className="block h-1 rounded-full bg-series-1"
                          style={{ width: `${((Number(raw) || 0) / maxByCol[c.key]) * 100}%` }}
                        />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <p className="px-2 pt-2 text-xs text-muted">+ {rows.length - maxRows} linha(s) — clique para ver tudo</p>
      )}
    </div>
  );
}

function HeatmapView({ data }: { data: HeatmapData }) {
  const max = Math.max(1, ...data.values.flat());
  return (
    <div>
      {data.hint && <p className="mb-3 text-sm text-ink-2">{data.hint}</p>}
      <div className="overflow-x-auto">
        <div className="inline-grid min-w-full gap-[2px]" style={{ gridTemplateColumns: `36px repeat(${data.cols.length}, minmax(14px, 1fr))` }}>
          <span />
          {data.cols.map((c, i) => (
            <span key={c} className="text-center text-[10px] text-muted">
              {i % 3 === 0 ? c : ''}
            </span>
          ))}
          {data.rows.map((r, ri) => (
            <div key={r} className="contents">
              <span className="pr-1 text-right text-[11px] leading-5 text-muted">{r}</span>
              {data.values[ri].map((v, ci) => (
                <span
                  key={ci}
                  title={`${r} ${data.cols[ci]}: ${v} mensagem(ns)`}
                  className="h-5 rounded-[3px]"
                  style={{
                    background:
                      v === 0
                        ? 'var(--surface-2)'
                        : `color-mix(in oklab, var(--series-1) ${Math.round(18 + (v / max) * 82)}%, var(--surface))`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-muted">
        menos
        {[0.18, 0.45, 0.72, 1].map((t) => (
          <span key={t} className="h-3 w-3 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--series-1) ${t * 100}%, var(--surface))` }} />
        ))}
        mais
      </div>
    </div>
  );
}

function SeriesView({ data }: { data: SeriesData }) {
  return (
    <div>
      {data.series.length > 1 && (
        <div className="mb-2">
          <Legend items={data.series.map((s, i) => ({ label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length] }))} />
        </div>
      )}
      {data.visual === 'series' ? (
        <SeriesChart data={data.data} series={data.series} format={data.format} />
      ) : (
        <BarsChart data={data.data} series={data.series} format={data.format} />
      )}
    </div>
  );
}

/** Desenha qualquer indicador a partir do formato padrão devolvido pelo banco. */
export function IndicatorView({ data, name, timeZone }: { data: IndicatorData; name: string; timeZone?: string }) {
  switch (data.visual) {
    case 'kpi':
      return <KpiView data={data} name={name} />;
    case 'table':
      return <DataTable columns={(data as TableData).columns} rows={(data as TableData).rows} timeZone={timeZone} maxRows={8} />;
    case 'heatmap':
      return <HeatmapView data={data} />;
    case 'series':
    case 'bars':
      return <SeriesView data={data} />;
    default:
      return (
        <p className="rounded-lg bg-critical/10 px-3 py-2 text-xs text-critical-ink">
          Não foi possível calcular este indicador: {'message' in data ? data.message : 'formato desconhecido'}
        </p>
      );
  }
}
