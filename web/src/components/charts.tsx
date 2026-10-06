'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatValue, type ValueFormat } from '@/lib/indicators';

const AXIS = { stroke: 'var(--axis)', fontSize: 11, tickLine: false, axisLine: false, tick: { fill: 'var(--muted)' } };

/** Cores categóricas em ordem fixa (nunca reaproveitadas por posição). */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

type TooltipEntry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format: ValueFormat;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{dayLabel(String(label))}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-4 font-medium text-ink">{formatValue(p.value, format)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** "2026-10-01" -> "01/10"; outros rótulos passam direto. */
const dayLabel = (x: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  return m ? `${m[3]}/${m[2]}` : x;
};

/** Pequena tendência por dia exibida dentro do cartão do indicador. */
export function TrendSparkline({
  data,
  format,
  label,
}: {
  data: { x: string; value: number | null }[];
  format: ValueFormat;
  label: string;
}) {
  if (data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={64}>
      <AreaChart data={data} margin={{ top: 6, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="x" hide />
        <Tooltip
          content={<ChartTooltip format={format} />}
          cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
        />
        <Area
          type="monotone"
          dataKey="value"
          name={label}
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#fillTrend)"
          connectNulls
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Série temporal genérica (várias linhas). */
export function SeriesChart({
  data,
  series,
  format,
}: {
  data: Record<string, unknown>[];
  series: { key: string; label: string }[];
  format: ValueFormat;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="x" tickFormatter={dayLabel} {...AXIS} minTickGap={16} />
        <YAxis {...AXIS} width={52} tickFormatter={(v: number) => formatValue(v, format)} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Barras por categoria (uma ou mais séries). */
export function BarsChart({
  data,
  series,
  format,
}: {
  data: Record<string, unknown>[];
  series: { key: string; label: string }[];
  format: ValueFormat;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        {/* muitas categorias (ex.: 24 horas): o eixo pula rótulos para não sobrepor */}
        <XAxis dataKey="label" {...AXIS} interval={data.length > 12 ? 'preserveStartEnd' : 0} minTickGap={6} />
        <YAxis {...AXIS} width={52} tickFormatter={(v: number) => formatValue(v, format)} allowDecimals={false} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: 'var(--surface-2)' }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
