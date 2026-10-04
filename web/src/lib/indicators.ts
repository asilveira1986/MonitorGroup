import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format';

/** Formatos de valor devolvidos pelas funções de cálculo (ind_<chave>). */
export type ValueFormat = 'number' | 'duration' | 'percent' | 'percent_delta' | 'datetime' | 'text';
export type Tone = 'good' | 'warning' | 'critical' | null;

export type Column = {
  key: string;
  label: string;
  format?: ValueFormat;
  align?: 'left' | 'right';
  /** coluna que leva à tela do grupo (valor = nome da coluna com o id) */
  link?: string;
  /** desenha uma barra proporcional ao maior valor da coluna */
  bar?: boolean;
  /** destaca valores cujo módulo seja >= este número (ex.: variação %) */
  highlight_abs_gte?: number;
};

export type KpiData = {
  visual: 'kpi';
  value: number | null;
  format: ValueFormat;
  tone?: Tone;
  hint?: string;
  secondary?: { label: string; value: number | null; format: ValueFormat }[];
  trend?: { format: ValueFormat; data: { x: string; value: number | null }[] };
};
export type TableData = { visual: 'table'; columns: Column[]; rows: Record<string, unknown>[] };
export type SeriesData = {
  visual: 'series' | 'bars';
  format: ValueFormat;
  series: { key: string; label: string }[];
  data: Record<string, unknown>[];
};
export type HeatmapData = { visual: 'heatmap'; rows: string[]; cols: string[]; values: number[][]; hint?: string };
export type ErrorData = { visual: 'error'; message: string };
export type IndicatorData = KpiData | TableData | SeriesData | HeatmapData | ErrorData;

export type IndicatorValue = {
  key: string;
  name: string;
  description: string | null;
  block_key: string;
  block_name: string;
  size: 1 | 2 | 3;
  has_details: boolean;
  data: IndicatorData;
};

export type ParamField = {
  key: string;
  label: string;
  type: 'int' | 'bool' | 'tags' | 'categories' | 'business_hours';
  unit?: string;
  min?: number;
  max?: number;
  help?: string;
};

export type IndicatorConfig = {
  key: string;
  block_key: string;
  name: string;
  description: string | null;
  position: number;
  visual: string;
  enabled: boolean;
  supports_alert: boolean;
  alert_enabled: boolean;
  params: Record<string, unknown>;
  param_schema: ParamField[];
  default_params: Record<string, unknown>;
  default_enabled: boolean;
  default_alert_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

export type BlockConfig = {
  key: string;
  name: string;
  description: string | null;
  position: number;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

export type DetailsData = { columns: Column[]; rows: Record<string, unknown>[] };

export function formatValue(value: unknown, format: ValueFormat = 'text', timeZone?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'number':
      return formatNumber(Number(value));
    case 'duration':
      return formatDuration(Number(value));
    case 'percent':
      return formatPercent(Number(value));
    case 'percent_delta': {
      const n = Number(value);
      return `${n > 0 ? '+' : ''}${formatPercent(n)}`;
    }
    case 'datetime':
      return formatDateTime(String(value), timeZone);
    default:
      return String(value);
  }
}

// classes completas (o Tailwind só gera classes escritas por extenso no código)
const SM_SPAN = ['', 'sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4', 'sm:col-span-5', 'sm:col-span-6'];
const XL_SPAN = ['', 'xl:col-span-1', 'xl:col-span-2', 'xl:col-span-3', 'xl:col-span-4', 'xl:col-span-5', 'xl:col-span-6'];

/** Largura base (em colunas de um grid de 6) por tamanho do indicador. */
const BASE = { sm: { 1: 3, 2: 6, 3: 6 }, xl: { 1: 2, 2: 3, 3: 6 } } as const;

/**
 * Distribui os cartões em linhas de 6 colunas: quando uma linha não fecha,
 * o último cartão dela se estica para ocupar o espaço — sem buracos, mesmo
 * quando indicadores são ligados/desligados.
 */
export function layoutSpans(sizes: number[]): string[] {
  const fill = (bp: 'sm' | 'xl') => {
    const spans = sizes.map((s) => BASE[bp][(s as 1 | 2 | 3) ?? 1] ?? BASE[bp][1]);
    let used = 0;
    let lastInRow = -1;
    spans.forEach((span, i) => {
      if (used + span > 6) {
        if (lastInRow >= 0) spans[lastInRow] += 6 - used;
        used = 0;
      }
      used += span;
      lastInRow = i;
      if (used === 6) used = 0;
    });
    if (used > 0 && lastInRow >= 0) spans[lastInRow] += 6 - used;
    return spans;
  };
  const sm = fill('sm');
  const xl = fill('xl');
  return sizes.map((_, i) => `${SM_SPAN[sm[i]]} ${XL_SPAN[xl[i]]}`);
}
