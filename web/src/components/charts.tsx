'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDuration, formatNumber } from '@/lib/format';

const AXIS = { stroke: 'var(--axis)', fontSize: 11, tickLine: false, axisLine: false, tick: { fill: 'var(--muted)' } };

type TooltipEntry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function ChartTooltip({
  active,
  payload,
  label,
  formatter = (v: number) => formatNumber(v),
  labelFormatter = (l: string) => l,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (v: number) => string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{labelFormatter(String(label))}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-4 font-medium text-ink">
            {p.value == null ? '—' : formatter(Number(p.value))}
          </span>
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

const dayLabel = (day: string) => {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
};

/** Volume diário: mensagens de clientes (recebidas) x da equipe (enviadas). */
export function VolumeChart({ data }: { data: { day: string; received: number; sent: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="fillReceived" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={dayLabel} {...AXIS} minTickGap={16} />
        <YAxis allowDecimals={false} {...AXIS} width={40} />
        <Tooltip
          content={<ChartTooltip labelFormatter={dayLabel} />}
          cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
        />
        <Area
          type="monotone"
          dataKey="received"
          name="Recebidas (clientes)"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#fillReceived)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
        <Area
          type="monotone"
          dataKey="sent"
          name="Enviadas (equipe)"
          stroke="var(--series-2)"
          strokeWidth={2}
          fill="url(#fillSent)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Tempo médio de 1ª resposta por dia, com a linha do SLA. */
export function ResponseTimeChart({
  data,
  slaMinutes,
}: {
  data: { day: string; avg_response_seconds: number | null }[];
  slaMinutes: number;
}) {
  const rows = data.map((d) => ({
    day: d.day,
    minutes: d.avg_response_seconds == null ? null : Math.round(d.avg_response_seconds / 6) / 10,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={rows} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="day" tickFormatter={dayLabel} {...AXIS} minTickGap={16} />
        <YAxis {...AXIS} width={56} tickFormatter={(v: number) => `${v} min`} />
        <Tooltip
          content={<ChartTooltip labelFormatter={dayLabel} formatter={(v) => formatDuration(v * 60)} />}
          cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
        />
        <ReferenceLine
          y={slaMinutes}
          stroke="var(--critical)"
          strokeDasharray="4 4"
          label={{ value: `SLA ${slaMinutes} min`, position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey="minutes"
          name="Tempo médio"
          stroke="var(--series-1)"
          strokeWidth={2}
          connectNulls
          dot={{ r: 3, strokeWidth: 2, fill: 'var(--surface)' }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Distribuição das respostas por faixa de tempo. */
export function BucketsChart({ data }: { data: { label: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis allowDecimals={false} {...AXIS} width={40} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="total" name="Respostas" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Mensagens por hora do dia. */
export function HourlyChart({ data }: { data: { hour: number; received: number; sent: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: `${String(d.hour).padStart(2, '0')}h` }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 10, right: 8, left: -12, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" {...AXIS} interval={2} />
        <YAxis allowDecimals={false} {...AXIS} width={40} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="received" name="Recebidas" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
        <Bar dataKey="sent" name="Enviadas" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
