import { AlertTriangle, LayoutDashboard, Tv } from 'lucide-react';
import Link from 'next/link';
import { DashboardGrid } from '@/components/indicators/dashboard-grid';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { loadIndicatorFilters } from '@/lib/indicator-filters';
import type { IndicatorValue } from '@/lib/indicators';
import { DashboardFilters } from './filters';

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const profile = await requireProfile();
  const { supabase, tz, filters, groups, members } = await loadIndicatorFilters(await searchParams);

  // o dashboard só conhece o catálogo: calcula os indicadores ativos, na ordem configurada
  const { data, error } = await supabase.rpc('indicator_values', {
    p_from: filters.from,
    p_to: filters.to,
    p_group_id: filters.groupId,
    p_member_id: filters.memberId,
  });
  const indicators = (data ?? []) as IndicatorValue[];

  return (
    // data-wide: o dashboard usa a largura toda da tela
    <div data-wide>
      <PageHeader
        title="Dashboard"
        stackAction
        description={
          <>
            Acompanhe o atendimento nos grupos de WhatsApp em tempo real.
            <br />
            Clique num indicador para ver os detalhes.
          </>
        }
        action={
          <DashboardFilters
            groups={groups}
            members={members}
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
        <DashboardGrid indicators={indicators} filters={filters} timeZone={tz} />
      )}
    </div>
  );
}
