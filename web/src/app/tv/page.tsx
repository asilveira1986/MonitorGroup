import type { Metadata } from 'next';
import { requireProfile } from '@/lib/auth';
import { loadIndicatorFilters, PERIOD_LABEL } from '@/lib/indicator-filters';
import type { IndicatorValue } from '@/lib/indicators';
import { TvBoard } from './board';

export const metadata: Metadata = { title: 'MonitorGroup · Modo TV' };

const nowIso = () => new Date().toISOString();
// ?rotacao=N (segundos entre as páginas de painéis, padrão 20; 0 = sem revezamento)
const rotation = (v: unknown) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && v !== undefined ? Math.max(0, Math.min(600, Math.round(n))) : 20;
};

/**
 * Modo TV: o dashboard numa tela só, sem menu, para deixar num monitor ou TV.
 * Aceita os mesmos filtros do dashboard (?period=today|7d|30d|90d&group=…&member=…)
 * ?tema=claro para o tema claro e ?rotacao=N para os segundos entre as páginas de painéis.
 */
export default async function TvPage({ searchParams }: PageProps<'/tv'>) {
  await requireProfile();
  const sp = await searchParams;
  const { supabase, period, tz, filters, groups, members } = await loadIndicatorFilters(sp);

  const [{ data, error }, { data: instances }, { count: openAlerts }] = await Promise.all([
    supabase.rpc('indicator_values', {
      p_from: filters.from,
      p_to: filters.to,
      p_group_id: filters.groupId,
      p_member_id: filters.memberId,
    }),
    supabase.from('whatsapp_instances').select('name, status'),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  const scope = [
    PERIOD_LABEL[period],
    groups.find((g) => g.id === filters.groupId)?.name,
    members.find((m) => m.id === filters.memberId)?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TvBoard
      indicators={(data ?? []) as IndicatorValue[]}
      error={error?.message ?? null}
      timeZone={tz}
      scope={scope}
      generatedAt={nowIso()}
      whatsapp={(instances ?? []).map((i) => ({ name: i.name as string, connected: i.status === 'connected' }))}
      openAlerts={openAlerts ?? 0}
      light={sp.tema === 'claro'}
      rotateSeconds={rotation(sp.rotacao)}
    />
  );
}
