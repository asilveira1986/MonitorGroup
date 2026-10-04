import { AlertTriangle, Download, FileBarChart } from 'lucide-react';
import Link from 'next/link';
import { DataTable, IndicatorView } from '@/components/indicators/views';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { loadIndicatorFilters, PERIOD_LABEL } from '@/lib/indicator-filters';
import type { IndicatorValue } from '@/lib/indicators';
import { indicatorTable } from '@/lib/report';
import { DashboardFilters } from '../dashboard/filters';
import { PrintButton } from './print-button';

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const { supabase, period, tz, filters, groups, members } = await loadIndicatorFilters(sp);

  const { data, error } = await supabase.rpc('indicator_values', {
    p_from: filters.from,
    p_to: filters.to,
    p_group_id: filters.groupId,
    p_member_id: filters.memberId,
  });
  const indicators = (data ?? []) as IndicatorValue[];

  // mesmos filtros da tela na exportação
  const query = new URLSearchParams();
  for (const k of ['period', 'group', 'member']) if (typeof sp[k] === 'string') query.set(k, sp[k] as string);
  const exportHref = (key?: string) => {
    const q = new URLSearchParams(query);
    if (key) q.set('key', key);
    return `/reports/export?${q.toString()}`;
  };

  const blocks = indicators.reduce<{ key: string; name: string; items: IndicatorValue[] }[]>((acc, ind) => {
    const block = acc.find((b) => b.key === ind.block_key);
    if (block) block.items.push(ind);
    else acc.push({ key: ind.block_key, name: ind.block_name, items: [ind] });
    return acc;
  }, []);

  const scope = [
    PERIOD_LABEL[period],
    groups.find((g) => g.id === filters.groupId)?.name ?? 'todos os grupos',
    members.find((m) => m.id === filters.memberId)?.name ?? 'todos os atendentes',
  ].join(' · ');

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Os indicadores ativos em formato de tabela, prontos para exportar. Use os mesmos filtros do dashboard."
        action={<DashboardFilters groups={groups} members={members} />}
      />

      {error ? (
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Não foi possível gerar o relatório" description={error.message} />
        </Card>
      ) : indicators.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileBarChart />}
            title="Nenhum indicador ativo"
            description={
              profile.role === 'admin'
                ? 'O relatório mostra só os indicadores ligados. Ative-os em Configurações › Indicadores.'
                : 'O relatório mostra só os indicadores ligados. Peça a um administrador para ativá-los.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
            <p className="text-sm text-ink-2">
              <span className="font-medium text-ink">{indicators.length} indicador(es)</span> · {scope}
            </p>
            <div className="flex flex-wrap gap-2">
              <PrintButton />
              <a
                href={exportHref()}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-medium text-brand-ink hover:opacity-90"
              >
                <Download className="h-4 w-4" /> Exportar relatório (CSV)
              </a>
            </div>
          </div>
          <p className="hidden text-sm text-ink-2 print:block">{scope}</p>

          {blocks.map((block) => (
            <section key={block.key} aria-labelledby={`block-${block.key}`} className="space-y-3">
              <h2 id={`block-${block.key}`} className="text-sm font-semibold uppercase tracking-wide text-muted">
                {block.name}
              </h2>
              {block.items.map((ind) => {
                const table = indicatorTable(ind.data);
                return (
                  <Card key={ind.key} className="break-inside-avoid p-4 sm:p-5">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-semibold text-ink">{ind.name}</h3>
                        {ind.description && <p className="mt-0.5 text-sm text-ink-2">{ind.description}</p>}
                      </div>
                      {ind.has_details && (
                        <a
                          href={exportHref(ind.key)}
                          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft print:hidden"
                        >
                          <Download className="h-3.5 w-3.5" /> Lista detalhada (CSV)
                        </a>
                      )}
                    </div>
                    {ind.data.visual === 'heatmap' ? (
                      <IndicatorView data={ind.data} name={ind.name} timeZone={tz} />
                    ) : (
                      <DataTable columns={table.columns} rows={table.rows} timeZone={tz} />
                    )}
                  </Card>
                );
              })}
            </section>
          ))}

          {profile.role === 'admin' && (
            <p className="text-xs text-muted print:hidden">
              Para incluir ou tirar indicadores do relatório, use{' '}
              <Link href="/settings/indicators" className="font-medium text-brand hover:underline">
                Configurações › Indicadores
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </>
  );
}
