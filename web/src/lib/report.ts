import { formatValue, type Column, type IndicatorData, type IndicatorValue } from '@/lib/indicators';

/**
 * Converte qualquer indicador (kpi, tabela, barras, série, mapa de calor) numa tabela simples.
 * É o que os relatórios mostram e exportam: assim um indicador novo entra no relatório sem código.
 */
export function indicatorTable(data: IndicatorData): { columns: Column[]; rows: Record<string, unknown>[] } {
  switch (data.visual) {
    case 'kpi':
      return {
        columns: [
          { key: 'metric', label: 'Métrica' },
          { key: 'value', label: 'Valor', format: 'text', align: 'right' },
        ],
        rows: [
          { metric: 'Valor principal', value: formatValue(data.value, data.format) },
          ...(data.secondary ?? []).map((s) => ({ metric: s.label, value: formatValue(s.value, s.format) })),
          ...(data.hint ? [{ metric: 'Observação', value: data.hint }] : []),
        ],
      };
    case 'table':
      return { columns: data.columns, rows: data.rows };
    case 'series':
    case 'bars':
      return {
        columns: [
          { key: data.visual === 'series' ? 'x' : 'label', label: data.visual === 'series' ? 'Data' : 'Item' },
          ...data.series.map((s) => ({ key: s.key, label: s.label, format: data.format, align: 'right' as const })),
        ],
        rows: data.data,
      };
    case 'heatmap':
      return {
        columns: [
          { key: 'row', label: 'Dia' },
          ...data.cols.map((c, i) => ({ key: `c${i}`, label: c, format: 'number' as const, align: 'right' as const })),
        ],
        rows: data.rows.map((r, ri) => ({
          row: r,
          ...Object.fromEntries(data.values[ri].map((v, ci) => [`c${ci}`, v])),
        })),
      };
    default:
      return { columns: [{ key: 'message', label: 'Erro' }], rows: [{ message: data.message }] };
  }
}

const cell = (value: string) => (/[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Linhas de CSV (separador ";", padrão do Excel em português) de uma tabela. */
export function tableToCsvLines(columns: Column[], rows: Record<string, unknown>[], timeZone?: string): string[] {
  const visible = columns.filter((c) => c.format !== 'spark');
  return [
    visible.map((c) => cell(c.label)).join(';'),
    ...rows.map((row) =>
      visible
        .map((c) => {
          const raw = row[c.key];
          const text = formatValue(raw, c.format, timeZone);
          return cell(text === '—' ? '' : text);
        })
        .join(';'),
    ),
  ];
}

/** Relatório completo: uma seção por indicador ativo, na ordem do catálogo. */
export function reportCsv(indicators: IndicatorValue[], header: string[], timeZone?: string): string {
  const lines = header.map(cell);
  for (const ind of indicators) {
    const { columns, rows } = indicatorTable(ind.data);
    lines.push('', cell(`${ind.block_name} › ${ind.name}`), ...tableToCsvLines(columns, rows, timeZone));
  }
  return toCsvFile(lines);
}

/** BOM + quebras CRLF: o Excel abre com acentos corretos. */
export const toCsvFile = (lines: string[]) => `﻿${lines.join('\r\n')}\r\n`;
