import { AlertTriangle, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { DashboardGrid } from '@/components/indicators/dashboard-grid';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { startOfDayInTz } from '@/lib/format';
import type { IndicatorValue } from '@/lib/indicators';
import { createClient } from '@/lib/supabase/server';
import { DashboardFilters } from './filters';

const DAYS: Record<string, number> = { today: 0, '7d': 6, '30d': 29, '90d': 89 };
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const period = typeof sp.period === 'string' && sp.period in DAYS ? sp.period : '7d';
  const groupId = isUuid(sp.group) ? sp.group : null;
  const memberId = isUuid(sp.member) ? sp.member : null;

  const supabase = await createClient();
  const [{ data: settings }, { data: groups }, { data: members }] = await Promise.all([
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
  ]);
  const tz = settings?.timezone ?? 'America/Sao_Paulo';
  const filters = {
    from: startOfDayInTz(tz, DAYS[period]).toISOString(),
    to: new Date().toISOString(),
    groupId,
    memberId,
  };

  // o dashboard só conhece o catálogo: calcula os indicadores ativos, na ordem configurada
  const { data, error } = await supabase.rpc('indicator_values', {
    p_from: filters.from,
    p_to: filters.to,
    p_group_id: groupId,
    p_member_id: memberId,
  });
  const indicators = (data ?? []) as IndicatorValue[];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Acompanhe o atendimento nos grupos de WhatsApp em tempo real. Clique num indicador para ver os detalhes."
        action={<DashboardFilters groups={groups ?? []} members={members ?? []} />}
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
    </>
  );
}
