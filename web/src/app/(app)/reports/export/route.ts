import type { NextRequest } from 'next/server';
import { requireProfile } from '@/lib/auth';
import { loadIndicatorFilters } from '@/lib/indicator-filters';
import type { DetailsData, IndicatorValue } from '@/lib/indicators';
import { reportCsv, tableToCsvLines, toCsvFile } from '@/lib/report';

/**
 * Exportação em CSV.
 *  ?key=<indicador>  -> lista que compõe o indicador (o mesmo detalhe do dashboard)
 *  sem key           -> relatório com todos os indicadores ativos
 * Os filtros são os mesmos da tela (period, date, group, member). As permissões são
 * conferidas no banco: só usuários ativos e só indicadores ligados.
 */
export async function GET(request: NextRequest) {
  await requireProfile();
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const { supabase, periodLabel, tz, filters, groups, members } = await loadIndicatorFilters(sp);
  const args = { p_from: filters.from, p_to: filters.to, p_group_id: filters.groupId, p_member_id: filters.memberId };
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  let csv: string;
  let filename: string;
  if (sp.key) {
    const { data, error } = await supabase.rpc('indicator_details', { p_key: sp.key, ...args });
    if (error) return new Response(error.message, { status: 400 });
    const details = data as DetailsData;
    csv = toCsvFile(tableToCsvLines(details.columns, details.rows, tz));
    filename = `${sp.key}-${stamp}.csv`;
  } else {
    const { data, error } = await supabase.rpc('indicator_values', args);
    if (error) return new Response(error.message, { status: 400 });
    const header = [
      'Relatório de indicadores - Monitor WhatsApp',
      `Período: ${periodLabel}`,
      `Grupo: ${groups.find((g) => g.id === filters.groupId)?.name ?? 'Todos'}`,
      `Atendente: ${members.find((m) => m.id === filters.memberId)?.name ?? 'Todos'}`,
      `Gerado em: ${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`,
    ];
    csv = reportCsv((data ?? []) as IndicatorValue[], header, tz);
    filename = `relatorio-indicadores-${stamp}.csv`;
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
