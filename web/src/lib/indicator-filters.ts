import { createClient } from '@/lib/supabase/server';

/** Períodos de vários dias (dias para trás a partir de hoje). */
export const PERIOD_DAYS: Record<string, number> = { '7d': 6, '30d': 29, '90d': 89 };
/** Períodos de um dia só: hoje, ontem ou um dia escolhido (?period=day&date=AAAA-MM-DD). */
export const DAY_PERIODS = ['today', 'yesterday', 'day'];
export const PERIOD_LABEL: Record<string, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
};

const DAY_MS = 86_400_000;
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Data (AAAA-MM-DD) de hoje no fuso da empresa. */
export function todayYmd(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(ymd: string, days: number) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Meia-noite de uma data AAAA-MM-DD no fuso da empresa. */
export function midnightInTz(timeZone: string, ymd: string): Date {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(noonUtc)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+00:00';
  return new Date(`${ymd}T00:00:00${offset}`);
}

/** "seg., 06/10" */
export function dayLabel(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

export type IndicatorFilters = { from: string; to: string; groupId: string | null; memberId: string | null };
/** Intervalo de comparação (dia anterior no mesmo horário, ou período anterior do mesmo tamanho). */
export type Comparison = { from: string; to: string; label: string };

/**
 * Lê os filtros da URL (período, dia, grupo, atendente) usados pelo dashboard, Modo TV e relatórios,
 * junto com as listas de grupos e atendentes e o fuso horário da empresa.
 */
export async function loadIndicatorFilters(sp: Record<string, unknown>, opts: { defaultPeriod?: string } = {}) {
  const supabase = await createClient();
  const [{ data: settings }, { data: groups }, { data: members }] = await Promise.all([
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
  ]);
  const tz = settings?.timezone ?? 'America/Sao_Paulo';
  const now = new Date();
  const today = todayYmd(tz, now);

  const rawPeriod = first(sp.period);
  const rawDate = first(sp.date);
  let period =
    typeof rawPeriod === 'string' && (rawPeriod in PERIOD_DAYS || DAY_PERIODS.includes(rawPeriod))
      ? rawPeriod
      : (opts.defaultPeriod ?? '7d');

  // dia escolhido: nunca no futuro; hoje e ontem viram os atalhos
  let day: string | null = null;
  if (period === 'today') day = today;
  else if (period === 'yesterday') day = addDays(today, -1);
  else if (period === 'day') {
    day = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today;
    if (day === today) period = 'today';
    else if (day === addDays(today, -1)) period = 'yesterday';
  }

  let from: Date;
  let to: Date;
  let comparison: Comparison;
  if (day) {
    from = midnightInTz(tz, day);
    const end = midnightInTz(tz, addDays(day, 1));
    to = end < now ? end : now;
    // dia anterior, no mesmo horário (hoje: ontem até esta hora)
    comparison = {
      from: midnightInTz(tz, addDays(day, -1)).toISOString(),
      to: new Date(midnightInTz(tz, addDays(day, -1)).getTime() + (to.getTime() - from.getTime())).toISOString(),
      label: period === 'today' ? 'ontem até esta hora' : 'o dia anterior',
    };
  } else {
    from = midnightInTz(tz, addDays(today, -PERIOD_DAYS[period]));
    to = now;
    const len = to.getTime() - from.getTime();
    comparison = {
      from: new Date(from.getTime() - len).toISOString(),
      to: from.toISOString(),
      label: 'o período anterior',
    };
  }

  const groupId = isUuid(first(sp.group)) ? (first(sp.group) as string) : null;
  const memberId = isUuid(first(sp.member)) ? (first(sp.member) as string) : null;
  const filters: IndicatorFilters = { from: from.toISOString(), to: to.toISOString(), groupId, memberId };
  const periodLabel = period === 'day' && day ? dayLabel(day) : PERIOD_LABEL[period];
  return {
    supabase,
    period,
    periodLabel,
    day,
    today,
    tz,
    filters,
    comparison,
    groups: groups ?? [],
    members: members ?? [],
  };
}
