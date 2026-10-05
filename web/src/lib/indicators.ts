import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format';

/** Formatos de valor devolvidos pelas funções de cálculo (ind_<chave>). */
export type ValueFormat = 'number' | 'duration' | 'percent' | 'percent_delta' | 'datetime' | 'text' | 'spark';
export type Tone = 'good' | 'warning' | 'critical' | null;

export type Column = {
  key: string;
  label: string;
  format?: ValueFormat;
  align?: 'left' | 'right';
  /** coluna que leva à tela do grupo (valor = nome da coluna com o id) */
  link?: string;
  /** coluna que abre a demanda (a linha traz demand_id) */
  link_demand?: boolean;
  /** desenha uma barra proporcional ao maior valor da coluna */
  bar?: boolean;
  /** destaca valores cujo módulo seja >= este número (ex.: variação %) */
  highlight_abs_gte?: number;
  /** destaca valores abaixo deste número (ex.: equipe pouco presente) */
  warn_below?: number;
};

export type KpiData = {
  visual: 'kpi';
  value: number | null;
  format: ValueFormat;
  /** texto pequeno ao lado do número (ex.: "grupos reincidentes") */
  unit?: string;
  tone?: Tone;
  hint?: string;
  secondary?: { label: string; value: number | null; format: ValueFormat }[];
  /** label: nome da série na dica do gráfico (padrão: nome do indicador) */
  trend?: { format: ValueFormat; label?: string; data: { x: string; value: number | null }[] };
  /** lista curta, um item por linha (ex.: grupo · 3 pendentes · há 2h) */
  list?: KpiListItem[];
  /** quantos itens o cartão mostra (a TV e a tela cheia mostram a lista inteira) */
  list_size?: number;
  /** quantos itens nem vieram na lista (além dos enviados) */
  list_more?: number;
};

export type KpiListItem = {
  label: string;
  /** texto secundário na mesma linha (ex.: grupo · remetente) */
  sublabel?: string;
  /** ícone do tipo de arquivo */
  icon?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  value?: number;
  /** texto após o número, no singular e no plural */
  unit?: [string, string];
  detail?: number | string | null;
  detail_format?: ValueFormat;
  /** destaque do item (ex.: fora do SLA) */
  tone?: Tone;
  group_id?: string;
};
export type TableData = { visual: 'table'; columns: Column[]; rows: Record<string, unknown>[] };
export type SeriesData = {
  visual: 'series' | 'bars';
  format: ValueFormat;
  series: { key: string; label: string }[];
  data: Record<string, unknown>[];
};
export type HeatmapData = {
  visual: 'heatmap';
  rows: string[];
  cols: string[];
  values: number[][];
  hint?: string;
  /** opcionais (horários de pico): resumo e totais por coluna/linha para uma leitura rápida */
  total?: number;
  highlights?: { label: string; value: string; detail?: string; tone?: Tone }[];
  by_hour?: { label: string; value: number }[];
  by_day?: { label: string; value: number }[];
  business?: { start_hour: number; end_hour: number; days: number[] };
};
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
    case 'spark':
      return Array.isArray(value) ? value.join(' ') : String(value);
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
 * o cartão maior dela (gráfico ou tabela) se estica para ocupar o espaço; cartões de número
 * ficam sempre compactos — sem buracos, mesmo
 * quando indicadores são ligados/desligados.
 */
export function layoutSpans(sizes: number[]): string[] {
  return layout(sizes).classes;
}

/**
 * Como layoutSpans, e também em que linha (tela larga) cada cartão ficou —
 * usado para não esticar a altura de um cartão de número ao lado de um gráfico.
 */
export function layout(sizes: number[]): { classes: string[]; rowXl: number[] } {
  const rowXl: number[] = [];
  let rowIndex = 0;
  const fill = (bp: 'sm' | 'xl') => {
    const spans = sizes.map((s) => BASE[bp][(s as 1 | 2 | 3) ?? 1] ?? BASE[bp][1]);
    let row: number[] = [];
    let used = 0;
    // a sobra da linha vai para o cartão maior dela (gráfico/tabela), não para um cartão de número
    const close = () => {
      if (row.length && used < 6) {
        const grow = row.reduce((best, i) => (sizes[i] >= sizes[best] ? i : best), row[0]);
        spans[grow] += 6 - used;
      }
      if (row.length && bp === 'xl') {
        for (const i of row) rowXl[i] = rowIndex;
        rowIndex += 1;
      }
      row = [];
      used = 0;
    };
    spans.forEach((span, i) => {
      if (used + span > 6) close();
      row.push(i);
      used += span;
      if (used === 6) close();
    });
    close();
    return spans;
  };
  const sm = fill('sm');
  const xl = fill('xl');
  return { classes: sizes.map((_, i) => `${SM_SPAN[sm[i]]} ${XL_SPAN[xl[i]]}`), rowXl };
}
