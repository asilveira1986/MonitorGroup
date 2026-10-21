import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemandStatusBadge } from '@/components/demands/status';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { cn, formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Demand } from '@/lib/types';
import { DeliverButton, PersonSelect } from './agenda-controls';

export const metadata: Metadata = { title: 'Monitor Group · Agenda' };

type Row = Demand & { groups: { name: string } | null; team_members: { name: string } | null };

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10-21" no fuso da empresa */
const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayTitle = (key: string, today: string) => {
  const [y, m, d] = key.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const label = `${wd}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  if (key === today) return `Hoje · ${label}`;
  if (key === addDays(today, 1)) return `Amanhã · ${label}`;
  return label;
};

/**
 * Agenda: as demandas que a pessoa tem para entregar, dia a dia, pelo prazo prometido.
 * Cada usuário vê a própria (a pessoa da equipe ligada ao e-mail de acesso dele);
 * administradores escolhem qualquer pessoa da equipe.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireMenu('/agenda');
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: myIdsRaw }, { data: team }, { data: settings }] = await Promise.all([
    supabase.rpc('my_team_member_ids'),
    supabase.from('team_members').select('id, name, active').order('name'),
    supabase.from('app_settings').select('timezone').maybeSingle(),
  ]);
  const myIds = Array.isArray(myIdsRaw) ? (myIdsRaw as string[]) : [];
  const timeZone = settings?.timezone ?? 'America/Sao_Paulo';
  const nowIso = new Date().toISOString();
  const now = new Date(nowIso).getTime();
  const today = dayKey(nowIso, timeZone);

  // de quem é a agenda: a própria; administrador escolhe outra pessoa
  const wanted = typeof sp.pessoa === 'string' ? sp.pessoa : null;
  const people = (team ?? []).filter((t) => t.active || t.id === wanted) as { id: string; name: string; active: boolean }[];
  const ids = isAdmin && wanted && people.some((p) => p.id === wanted) ? [wanted] : myIds;
  const personName = ids.length === 1 ? (people.find((p) => p.id === ids[0])?.name ?? null) : null;
  const viewingOther = isAdmin && Boolean(wanted) && !myIds.includes(ids[0] ?? '');

  const month = typeof sp.mes === 'string' && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const day = typeof sp.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : null;
  const [my, mm] = month.split('-').map(Number);
  const monthDays = new Date(Date.UTC(my, mm, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(my, mm - 1, 1)).getUTCDay();

  let open: Row[] = [];
  let delivered: Row[] = [];
  if (ids.length) {
    // entregues do mês mostrado e de hoje (um dia a mais por causa do fuso)
    const [ty, tm, td] = today.split('-').map(Number);
    const since = new Date(Math.min(Date.UTC(my, mm - 1, 1), Date.UTC(ty, tm - 1, td)) - 86_400_000).toISOString();
    const [o, d] = await Promise.all([
      supabase
        .from('demands')
        .select('*, groups(name), team_members(name)')
        .in('assignee_id', ids)
        .in('status', ['aberta', 'em_andamento'])
        .order('promised_at', { ascending: true, nullsFirst: false })
        .limit(1000),
      supabase
        .from('demands')
        .select('*, groups(name), team_members(name)')
        .in('assignee_id', ids)
        .eq('status', 'entregue')
        .gte('delivered_at', since)
        .order('delivered_at', { ascending: false })
        .limit(1000),
    ]);
    open = (o.data ?? []) as Row[];
    delivered = (d.data ?? []) as Row[];
  }

  // por dia: a entregar (pelo prazo) e entregues (pelo dia da entrega)
  const dueOn = new Map<string, Row[]>();
  for (const r of open) if (r.promised_at) dueOn.set(dayKey(r.promised_at, timeZone), [...(dueOn.get(dayKey(r.promised_at, timeZone)) ?? []), r]);
  const doneOn = new Map<string, Row[]>();
  for (const r of delivered)
    if (r.delivered_at) doneOn.set(dayKey(r.delivered_at, timeZone), [...(doneOn.get(dayKey(r.delivered_at, timeZone)) ?? []), r]);
  const late = open.filter((r) => r.promised_at && new Date(r.promised_at).getTime() < now);
  const noDate = open.filter((r) => !r.promised_at);
  const upcomingDays = [...dueOn.keys()].filter((k) => k >= today).sort();

  const href = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { pessoa: isAdmin ? wanted : null, mes: month === today.slice(0, 7) ? null : month, dia: day };
    for (const [k, v] of Object.entries({ ...cur, ...changes })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/agenda?${s}` : '/agenda';
  };
  const prevMonth = new Date(Date.UTC(my, mm - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(my, mm, 1)).toISOString().slice(0, 7);
  const canDeliver = (r: Row) => Boolean(r.assignee_id && myIds.includes(r.assignee_id));

  const item = (r: Row, opts: { done?: boolean } = {}) => {
    const overdue = !opts.done && r.promised_at && new Date(r.promised_at).getTime() < now;
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <span
          className={cn(
            'tabular w-12 shrink-0 text-xs font-semibold',
            opts.done ? 'text-good-ink' : overdue ? 'text-critical-ink' : 'text-ink-2',
          )}
        >
          {opts.done
            ? r.delivered_at && formatTime(r.delivered_at, timeZone)
            : r.promised_at
              ? formatTime(r.promised_at, timeZone)
              : '—'}
        </span>
        <Link href={`/demands?id=${r.id}`} className="min-w-0 flex-1 basis-56 hover:underline">
          <p className="line-clamp-2 text-sm font-medium">
            <span className="text-muted">#{r.number}</span> {r.description}
          </p>
          <p className="truncate text-xs text-ink-2">
            {r.groups?.name ?? '—'}
            {overdue && <span className="ml-2 font-medium text-critical-ink">prazo vencido</span>}
          </p>
        </Link>
        <DemandStatusBadge status={r.status} />
        {!opts.done && canDeliver(r) && <DeliverButton id={r.id} number={r.number} />}
      </li>
    );
  };

  const section = (title: React.ReactNode, rows: Row[], opts: { done?: boolean; tone?: 'critical' | 'good' } = {}) =>
    rows.length > 0 && (
      <Card key={String(title)} className="overflow-hidden">
        <h2
          className={cn(
            'flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-semibold sm:px-5',
            opts.tone === 'critical' && 'text-critical-ink',
            opts.tone === 'good' && 'text-good-ink',
          )}
        >
          {title} <span className="tabular rounded-full bg-surface-2 px-2 text-[11px] font-semibold text-ink-2">{rows.length}</span>
        </h2>
        <ul className="divide-y divide-line">{rows.map((r) => item(r, opts))}</ul>
      </Card>
    );

  return (
    <>
      <PageHeader
        title="Agenda"
        description="As demandas para entregar em cada dia, pelo prazo prometido. Só o responsável marca a entrega, pelo botão “Demanda entregue”."
        action={
          isAdmin ? (
            <PersonSelect
              value={ids.length === 1 && (viewingOther || !myIds.length) ? ids[0] : ''}
              mine={myIds.length > 0}
              people={people.map((p) => ({ id: p.id, name: p.active ? p.name : `${p.name} (inativo)` }))}
            />
          ) : undefined
        }
      />

      {!ids.length ? (
        <Card>
          <EmptyState
            icon={<UserRound />}
            title="Sua agenda ainda não está ligada à equipe"
            description={
              isAdmin
                ? 'Escolha uma pessoa da equipe acima para ver a agenda dela. Para ter a sua, um administrador liga o seu e-mail a uma pessoa em Configurações › Equipe › Dar acesso ao sistema.'
                : 'Peça a um administrador para ligar o seu e-mail a uma pessoa da equipe (Configurações › Equipe › Dar acesso ao sistema). Depois disso, as demandas em que você é o responsável aparecem aqui.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <Link href={href({ mes: prevMonth, dia: null })} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Mês anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <p className="text-sm font-semibold capitalize">
                  {MONTHS[mm - 1]} {my}
                </p>
                <Link href={href({ mes: nextMonth, dia: null })} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Próximo mês">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <span key={`x${i}`} />
                ))}
                {Array.from({ length: monthDays }, (_, i) => {
                  const key = `${month}-${String(i + 1).padStart(2, '0')}`;
                  const due = dueOn.get(key)?.length ?? 0;
                  const done = doneOn.get(key)?.length ?? 0;
                  const past = key < today;
                  return (
                    <Link
                      key={key}
                      href={href({ dia: day === key ? null : key })}
                      aria-label={`${i + 1}: ${due} a entregar, ${done} entregue(s)`}
                      aria-current={day === key ? 'date' : undefined}
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center rounded-lg text-xs transition hover:bg-surface-2',
                        key === today && 'ring-1 ring-brand-line',
                        day === key && 'bg-brand-soft font-semibold text-brand-text',
                      )}
                    >
                      <span className="tabular">{i + 1}</span>
                      <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                        {due > 0 && (
                          <span
                            className={cn(
                              'tabular rounded-full px-1 text-[9px] font-semibold leading-tight text-white',
                              past ? 'bg-critical' : 'bg-warning text-black',
                            )}
                          >
                            {due}
                          </span>
                        )}
                        {done > 0 && <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden />}
                      </span>
                    </Link>
                  );
                })}
              </div>
              <p className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-warning" /> a entregar
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-critical" /> atrasada
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-good" /> entregue
                </span>
              </p>
            </Card>
            <Card className="grid grid-cols-3 divide-x divide-line text-center">
              <div className="p-3">
                <p className="tabular text-xl font-semibold text-critical-ink">{late.length}</p>
                <p className="text-[11px] text-ink-2">atrasadas</p>
              </div>
              <div className="p-3">
                <p className="tabular text-xl font-semibold">{dueOn.get(today)?.filter((r) => new Date(r.promised_at!).getTime() >= now).length ?? 0}</p>
                <p className="text-[11px] text-ink-2">para hoje</p>
              </div>
              <div className="p-3">
                <p className="tabular text-xl font-semibold text-good-ink">{doneOn.get(today)?.length ?? 0}</p>
                <p className="text-[11px] text-ink-2">entregues hoje</p>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            {personName && (viewingOther || ids.length === 1) && (
              <p className="text-sm text-ink-2">
                Agenda de <strong className="text-ink">{personName}</strong>
                {viewingOther && ' (somente o responsável marca a entrega)'}
              </p>
            )}
            {day ? (
              <>
                {section(
                  <>
                    <CalendarDays className="h-4 w-4" /> {dayTitle(day, today)} · a entregar
                  </>,
                  dueOn.get(day) ?? [],
                  { tone: day < today ? 'critical' : undefined },
                )}
                {section(
                  <>
                    <CheckCircle2 className="h-4 w-4" /> {dayTitle(day, today)} · entregues
                  </>,
                  doneOn.get(day) ?? [],
                  { done: true, tone: 'good' },
                )}
                {!dueOn.get(day)?.length && !doneOn.get(day)?.length && (
                  <Card>
                    <EmptyState icon={<CalendarDays />} title="Nada neste dia" description="Nenhuma demanda com prazo ou entrega neste dia." />
                  </Card>
                )}
                <Link href={href({ dia: null })} className="inline-block text-sm text-brand-text hover:underline">
                  Ver a agenda completa
                </Link>
              </>
            ) : (
              <>
                {section(
                  <>
                    <AlertTriangle className="h-4 w-4" /> Atrasadas
                  </>,
                  late,
                  { tone: 'critical' },
                )}
                {upcomingDays.map((k) =>
                  section(
                    <>
                      <CalendarDays className="h-4 w-4" /> {dayTitle(k, today)}
                    </>,
                    (dueOn.get(k) ?? []).filter((r) => new Date(r.promised_at!).getTime() >= now),
                  ),
                )}
                {section(
                  <>
                    <Clock className="h-4 w-4" /> Sem prazo definido
                  </>,
                  noDate,
                )}
                {section(
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Entregues hoje
                  </>,
                  doneOn.get(today) ?? [],
                  { done: true, tone: 'good' },
                )}
                {!open.length && !doneOn.get(today)?.length && (
                  <Card>
                    <EmptyState
                      icon={<CheckCircle2 />}
                      title="Nenhuma demanda para entregar"
                      description="Quando uma demanda tiver este responsável, ela aparece aqui no dia do prazo prometido."
                    />
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
