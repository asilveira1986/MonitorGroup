import { startOfDayInTz } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

/** Períodos aceitos nos filtros (dias para trás a partir de hoje). */
export const PERIOD_DAYS: Record<string, number> = { today: 0, '7d': 6, '30d': 29, '90d': 89 };
export const PERIOD_LABEL: Record<string, string> = { today: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias' };

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export type IndicatorFilters = { from: string; to: string; groupId: string | null; memberId: string | null };

/**
 * Lê os filtros da URL (período, grupo, atendente) usados pelo dashboard e pelos relatórios,
 * junto com as listas de grupos e atendentes e o fuso horário da empresa.
 */
export async function loadIndicatorFilters(sp: Record<string, unknown>) {
  const rawPeriod = first(sp.period);
  const period = typeof rawPeriod === 'string' && rawPeriod in PERIOD_DAYS ? rawPeriod : '7d';
  const groupId = isUuid(first(sp.group)) ? (first(sp.group) as string) : null;
  const memberId = isUuid(first(sp.member)) ? (first(sp.member) as string) : null;

  const supabase = await createClient();
  const [{ data: settings }, { data: groups }, { data: members }] = await Promise.all([
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
  ]);
  const tz = settings?.timezone ?? 'America/Sao_Paulo';
  const filters: IndicatorFilters = {
    from: startOfDayInTz(tz, PERIOD_DAYS[period]).toISOString(),
    to: new Date().toISOString(),
    groupId,
    memberId,
  };
  return { supabase, period, tz, filters, groups: groups ?? [], members: members ?? [] };
}
