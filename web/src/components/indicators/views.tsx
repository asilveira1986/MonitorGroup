'use client';

import { AlertOctagon, AlertTriangle, ArrowUpRight, CheckCheck, CheckCircle2, FileText, Image as ImageIcon, Mic, Smile, Video } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { markMediaSeen } from '@/app/(app)/actions';
import { BarsChart, Legend, SERIES_COLORS, SeriesChart, TrendSparkline } from '@/components/charts';
import { cn, formatDuration, formatNumber } from '@/lib/format';
import { PeakHoursView } from './peak-hours';
import {
  formatValue,
  type Column,
  type HeatmapData,
  type IndicatorData,
  type KpiData,
  type KpiListItem,
  type SeriesData,
  type TableData,
} from '@/lib/indicators';

const TONE = {
  good: { cls: 'bg-good/12 text-good-ink', icon: CheckCircle2, label: 'Dentro do esperado' },
  warning: { cls: 'bg-warning/15 text-warning-ink', icon: AlertTriangle, label: 'Atenção' },
  critical: { cls: 'bg-critical/12 text-critical-ink', icon: AlertOctagon, label: 'Crítico' },
};

const FILE_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Smile };

/** Lista compacta do KPI: cada item numa linha, nome à esquerda, número e detalhe à direita. */
function KpiList({
  items,
  more,
  timeZone,
  actions = true,
}: {
  items: KpiListItem[];
  more?: number;
  timeZone?: string;
  /** mostra os botões de ação dos itens (o modo TV não mostra) */
  actions?: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, startTransition] = useTransition();
  const ack = (id: string) =>
    startTransition(async () => {
      const r = await markMediaSeen({ messageId: id });
      if (r.ok) {
        setDone((prev) => new Set(prev).add(id));
        router.refresh();
      }
    });
  const shown = items.filter((it) => !it.ack_id || !done.has(it.ack_id));
  return (
    <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
      {shown.map((it, i) => {
        const Icon = it.icon ? FILE_ICON[it.icon] : null;
        const text = (
          <>
            <span className="truncate font-medium text-ink">{it.label}</span>
            {it.sublabel && <span className="truncate text-xs text-muted">{it.sublabel}</span>}
          </>
        );
        const label = it.group_id ? (
          <Link
            href={`/groups/${it.group_id}`}
            className="flex min-w-0 flex-col hover:[&>span:first-child]:text-brand sm:flex-row sm:items-baseline sm:gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {text}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">{text}</span>
        );
        return (
          <li key={`${it.label}-${i}`} className="flex items-center gap-2 py-1.5">
            {it.tone && (
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  it.tone === 'critical' ? 'bg-critical' : it.tone === 'warning' ? 'bg-warning' : 'bg-good',
                )}
                aria-hidden
              />
            )}
            {Icon && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                <Icon className="h-4 w-4" aria-label={it.icon} />
              </span>
            )}
            <span className="flex min-w-0 flex-1">{label}</span>
            <span className="shrink-0 whitespace-nowrap tabular text-xs text-ink-2">
              {it.value != null && <span className="font-semibold text-ink">{formatValue(it.value, 'number')}</span>}
              {it.value != null && it.unit && ` ${it.value === 1 ? it.unit[0] : it.unit[1]}`}
              {it.detail != null && it.detail !== '' && (
                <span className="text-muted">
                  {it.value != null && ' · '}
                  {formatValue(it.detail, it.detail_format ?? 'text', timeZone)}
                </span>
              )}
            </span>
            {actions && it.ack_id && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  ack(it.ack_id!);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:border-brand hover:text-brand disabled:opacity-50"
                title="Marcar como visto"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden /> dar baixa
              </button>
            )}
          </li>
        );
      })}
      {!!more && <li className="py-1.5 text-xs text-muted">+ {more} — clique para ver todos</li>}
    </ul>
  );
}

export type Previous = { value: number | null; label: string };

/** Variação do número em relação ao intervalo de comparação: "▲ 12 (+30%) vs ontem até esta hora". */
function Delta({ value, previous, format }: { value: number | null; previous: Previous; format: KpiData['format'] }) {
  if (value == null || previous.value == null) return null;
  const cur = Number(value);
  const before = Number(previous.value);
  const diff = cur - before;
  // número igual: não mostra (os números de "agora", como pendentes, não mudam com o período)
  if (diff === 0) return null;
  const arrow = diff > 0 ? '▲' : '▼';
  const amount =
    format === 'percent'
        ? `${formatNumber(Math.abs(Math.round(diff * 10) / 10))} p.p. vs`
      : format === 'duration'
        ? `${formatDuration(Math.abs(diff))} vs`
        : `${formatNumber(Math.abs(diff))}${before > 0 ? ` (${diff > 0 ? '+' : '−'}${Math.round((Math.abs(diff) / before) * 100)}%)` : ''} vs`;
  return (
    <p className="mt-1 text-xs text-ink-2" title={`Em ${previous.label}: ${formatValue(before, format)}`}>
      <span className="font-medium">{arrow}</span> {amount} {previous.label}
      <span className="text-muted"> · era {formatValue(before, format)}</span>
    </p>
  );
}

function KpiView({
  data,
  name,
  timeZone,
  expanded,
  compact,
  previous,
}: {
  data: KpiData;
  name: string;
  timeZone?: string;
  expanded?: boolean;
  compact?: boolean;
  previous?: Previous;
}) {
  const allItems = data.list ?? [];
  const items = expanded || !data.list_size ? allItems : allItems.slice(0, data.list_size);
  const more = allItems.length - items.length + (data.list_more ?? 0);
  const tone = data.tone ? TONE[data.tone] : null;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold tracking-tight">{formatValue(data.value, data.format)}</span>
          {data.unit && <span className="text-sm font-medium text-ink-2">{data.unit}</span>}
        </p>
        {tone && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone.cls)}>
            <tone.icon className="h-3.5 w-3.5" aria-hidden /> {tone.label}
          </span>
        )}
      </div>
      {previous && <Delta value={data.value} previous={previous} format={data.format} />}
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
      {!!items.length && <KpiList items={items} more={more} timeZone={timeZone} actions={!compact} />}
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

function DataRow({
  row,
  cols,
  maxByCol,
  timeZone,
  groupLink,
}: {
  row: Record<string, unknown>;
  cols: Column[];
  maxByCol: Record<string, number>;
  timeZone?: string;
  /** coluna com o id do grupo: a última célula vira o botão "Ver grupo" */
  groupLink?: string;
}) {
  return (
    <tr className="border-t border-line align-top">
      {cols.map((c) => {
        const raw = row[c.key];
        const text = formatValue(raw, c.format, timeZone);
        const highlighted =
          c.highlight_abs_gte != null && raw != null && Math.abs(Number(raw)) >= c.highlight_abs_gte;
        const below = c.warn_below != null && raw != null && Number(raw) < c.warn_below;
        return (
          <td
            key={c.key}
            className={cn('whitespace-nowrap px-2 py-2', c.align === 'right' && 'text-right')}
            title={!c.format && text.length > 40 ? text : undefined}
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
            ) : c.link ? (
              <span className="block max-w-[240px] truncate font-medium">{text}</span>
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
              <span className={cn(!c.format && 'block max-w-[320px] truncate')}>{text}</span>
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
      {groupLink && (
        // fixa à direita: o botão fica visível mesmo quando a tabela rola para o lado
        <td className="sticky right-0 whitespace-nowrap bg-surface px-2 py-1.5 text-right shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.25)]">
          {row[groupLink] ? (
            <Link
              href={`/groups/${row[groupLink]}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
            >
              Ver grupo <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </td>
      )}
    </tr>
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
  // tabelas com grupo ganham, na última coluna, o botão para abrir o grupo
  const groupLink = columns.find((c) => c.link)?.link;
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
            {groupLink && <th className="sticky right-0 bg-surface px-2 py-2" aria-label="Ações" />}
          </tr>
        </thead>
        <tbody className="tabular">
          {shown.map((row, i) => (
            <DataRow key={i} row={row} cols={columns} maxByCol={maxByCol} timeZone={timeZone} groupLink={groupLink} />
          ))}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <p className="px-2 pt-2 text-xs text-muted">+ {rows.length - maxRows} linha(s) — clique para ver tudo</p>
      )}
    </div>
  );
}

function HeatmapView({ data, compact }: { data: HeatmapData; compact?: boolean }) {
  // com totais por hora/dia (horários de pico): resumo + gráficos simples, mapa como detalhe
  if (data.by_hour) return <PeakHoursView data={data} heatmap={<HeatmapGrid data={data} />} compact={compact} />;
  return <HeatmapGrid data={data} withHint />;
}

function HeatmapGrid({ data, withHint }: { data: HeatmapData; withHint?: boolean }) {
  const max = Math.max(1, ...data.values.flat());
  return (
    <div>
      {withHint && data.hint && <p className="mb-3 text-sm text-ink-2">{data.hint}</p>}
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
export function IndicatorView({
  data,
  name,
  timeZone,
  expanded,
  compact,
  previous,
}: {
  data: IndicatorData;
  name: string;
  timeZone?: string;
  /** valor do mesmo número no intervalo de comparação (ex.: ontem até esta hora) */
  previous?: Previous;
  /** tela cheia: tabelas com todas as linhas */
  expanded?: boolean;
  /** modo TV: sem controles de interação */
  compact?: boolean;
}) {
  switch (data.visual) {
    case 'kpi':
      return <KpiView data={data} name={name} timeZone={timeZone} expanded={expanded} compact={compact} previous={previous} />;
    case 'table':
      return (
        <DataTable
          columns={(data as TableData).columns}
          rows={(data as TableData).rows}
          timeZone={timeZone}
          maxRows={expanded ? undefined : 8}
        />
      );
    case 'heatmap':
      return <HeatmapView data={data} compact={compact} />;
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
