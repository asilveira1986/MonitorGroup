import { AlertTriangle, LayoutDashboard, Tv } from 'lucide-react';
import Link from 'next/link';
import { DashboardGrid } from '@/components/indicators/dashboard-grid';
import { DetailsSection } from '@/components/indicators/details-section';
import { ManagementSummary, type ManagementSummaryData } from '@/components/indicators/management-summary';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { loadIndicatorFilters } from '@/lib/indicator-filters';
import type { IndicatorValue, KpiData } from '@/lib/indicators';
import { DashboardFilters } from './filters';

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const profile = await requireMenu('/dashboard');
  const { supabase, tz, filters, comparison, today, groups, members, periodLabel, period } = await loadIndicatorFilters(await searchParams, {
    defaultPeriod: 'today',
  });

  // o dashboard só conhece o catálogo: calcula os indicadores ativos, na ordem configurada
  // e, junto, o mesmo cálculo no intervalo de comparação (dia anterior no mesmo horário)
  const args = { p_group_id: filters.groupId, p_member_id: filters.memberId };
  const [{ data, error }, { data: before }, { data: summary }, { data: summaryBefore }] = await Promise.all([
    supabase.rpc('indicator_values', { p_from: filters.from, p_to: filters.to, ...args }),
    supabase.rpc('indicator_values', { p_from: comparison.from, p_to: comparison.to, ...args }),
    // visão da gestão: totalizadores do período e do intervalo de comparação
    supabase.rpc('management_summary', { p_from: filters.from, p_to: filters.to, ...args }),
    supabase.rpc('management_summary', { p_from: comparison.from, p_to: comparison.to, ...args }),
  ]);
  const indicators = (data ?? []) as IndicatorValue[];
  const previous = Object.fromEntries(
    ((before ?? []) as IndicatorValue[])
      .filter((i) => i.data.visual === 'kpi')
      .map((i) => [i.key, (i.data as KpiData).value]),
  );

  return (
    // data-wide: o dashboard usa a largura toda da tela
    <div data-wide>
      <PageHeader
        title="Dashboard"
        stackAction
        description={
          <>
            Os números que a gestão precisa acompanhar, comparados com {comparison.label}.
            <br />
            Clique num número para abrir a tela correspondente.
          </>
        }
        action={
          <DashboardFilters
            groups={groups}
            members={members}
            today={today}
            defaultPeriod="today"
            extra={
              <Link
                href="/tv"
                target="_blank"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-9 sm:w-9"
                title="Modo TV: abrir o dashboard em tela cheia para deixar num monitor ou TV"
                aria-label="Modo TV"
              >
                <Tv className="h-4 w-4" />
              </Link>
            }
          />
        }
      />

      {summary && (
        <ManagementSummary
          data={summary as ManagementSummaryData}
          previous={(summaryBefore as ManagementSummaryData | null) ?? null}
          periodLabel={periodLabel.toLowerCase()}
          comparisonLabel={period === 'today' ? 'ontem' : period === 'yesterday' ? 'anteontem' : 'período anterior'}
        />
      )}

      {error ? (
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Não foi possível carregar os indicadores" description={error.message} />
        </Card>
      ) : indicators.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayoutDashboard />}
            title="Nenhum indicador ativo"
            description={
              profile.role === 'admin'
                ? 'Todos os indicadores estão desligados. Ative os que quiser acompanhar em Configurações › Indicadores.'
                : 'Todos os indicadores estão desligados. Peça a um administrador para ativá-los.'
            }
            action={
              profile.role === 'admin' && (
                <Link
                  href="/settings/indicators"
                  className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
                >
                  Ativar indicadores
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <DetailsSection count={indicators.length}>
          <DashboardGrid
            indicators={indicators}
            filters={filters}
            timeZone={tz}
            comparison={{ label: comparison.label, values: previous }}
          />
        </DetailsSection>
      )}
    </div>
  );
}
