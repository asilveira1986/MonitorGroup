import { AlertTriangle, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { DashboardGrid } from '@/components/indicators/dashboard-grid';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import type { IndicatorValue, KpiData } from '@/lib/indicators';
import type { Comparison, IndicatorFilters } from '@/lib/indicator-filters';
import { createClient } from '@/lib/supabase/server';

/**
 * Dashboard das conversas privadas (0130): os mesmos cartões, gráfico e tabela do dashboard dos grupos,
 * calculados no banco com as permissões de quem vê.
 */
export async function PrivateDashboard({
  filters,
  comparison,
  tz,
  user,
  header,
}: {
  filters: IndicatorFilters;
  comparison: Comparison;
  tz: string;
  user: string | null;
  header: ReactNode;
}) {
  const supabase = await createClient();
  const [{ data, error }, { data: before }] = await Promise.all([
    supabase.rpc('private_dashboard', { p_from: filters.from, p_to: filters.to, p_user: user, p_kpi_only: false }),
    supabase.rpc('private_dashboard', { p_from: comparison.from, p_to: comparison.to, p_user: user, p_kpi_only: true }),
  ]);
  const indicators = (data ?? []) as IndicatorValue[];
  const previous = Object.fromEntries(
    ((before ?? []) as IndicatorValue[])
      // "agora" (sem resposta, na fila) não tem como comparar com o período anterior
      .filter((i) => i.data.visual === 'kpi' && i.key !== 'priv_sem_resposta' && i.key !== 'priv_fila')
      .map((i) => [i.key, (i.data as KpiData).value]),
  );

  return (
    <div data-wide>
      <PageHeader
        title="Dashboard"
        stackAction
        description={
          <>
            Conversas privadas: volume, tempo de resposta e atendimento por usuário, comparados com {comparison.label}.
            <br />
            “Sem resposta agora” e “Aguardando atendimento” mostram a situação deste momento.
          </>
        }
        action={header}
      />
      {error ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle />}
            title="Não foi possível carregar os números das conversas privadas"
            description={/private_dashboard/.test(error.message) ? 'Rode o atualizar_banco.sql no Supabase (script 0130).' : error.message}
          />
        </Card>
      ) : indicators.length === 0 ? (
        <Card>
          <EmptyState icon={<MessageCircle />} title="Sem conversas privadas" description="As conversas privadas não estão liberadas para você." />
        </Card>
      ) : (
        <DashboardGrid indicators={indicators} filters={filters} timeZone={tz} comparison={{ label: comparison.label, values: previous }} />
      )}
    </div>
  );
}
