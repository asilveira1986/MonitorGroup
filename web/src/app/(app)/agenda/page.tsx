import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemandStatusBadge } from '@/components/demands/status';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { cn, formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Demand } from '@/lib/types';
import { DeliverButton, PersonSelect } from './agenda-controls';
import { EventActions, NewEventButton, type AgendaEvent } from './event-controls';

export const metadata: Metadata = { title: 'Monitor Group · Agenda' };

type Row = Demand & { groups: { name: string } | null; team_members: { name: string } | null };
/** uma linha da agenda: demanda (a entregar ou entregue) ou compromisso */
type Entry = { kind: 'demand'; r: Row; done?: boolean } | { kind: 'event'; e: AgendaEvent };
const entryTime = (x: Entry) =>
  x.kind === 'event'
    ? x.e.all_day
      ? 0
      : new Date(x.e.starts_at).getTime()
    : new Date((x.done ? x.r.delivered_at : x.r.promised_at) ?? 0).getTime();

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
 * Agenda: as demandas que a pessoa tem para entregar, dia a dia, pelo prazo prometido,
 * e os compromissos registrados à mão.
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
  let events: AgendaEvent[] = [];
  if (ids.length) {
    // entregues do mês mostrado e de hoje (um dia a mais por causa do fuso)
    const [ty, tm, td] = today.split('-').map(Number);
    const since = new Date(Math.min(Date.UTC(my, mm - 1, 1), Date.UTC(ty, tm - 1, td)) - 86_400_000).toISOString();
    const [o, d, ev] = await Promise.all([
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
      // compromissos: do mês mostrado em diante (sem o script 0060, nenhum)
      supabase
        .from('agenda_events')
        .select('id, member_id, title, notes, starts_at, all_day, done_at')
        .in('member_id', ids)
        .gte('starts_at', since)
        .order('starts_at')
        .limit(1000),
    ]);
    open = (o.data ?? []) as Row[];
    delivered = (d.data ?? []) as Row[];
    events = (ev.data ?? []) as AgendaEvent[];
  }

  // por dia: a entregar (pelo prazo) e entregues (pelo dia da entrega)
  const dueOn = new Map<string, Row[]>();
  for (const r of open) if (r.promised_at) dueOn.set(dayKey(r.promised_at, timeZone), [...(dueOn.get(dayKey(r.promised_at, timeZone)) ?? []), r]);
  const doneOn = new Map<string, Row[]>();
  for (const r of delivered)
    if (r.delivered_at) doneOn.set(dayKey(r.delivered_at, timeZone), [...(doneOn.get(dayKey(r.delivered_at, timeZone)) ?? []), r]);
  const eventsOn = new Map<string, AgendaEvent[]>();
  for (const e of events) eventsOn.set(dayKey(e.starts_at, timeZone), [...(eventsOn.get(dayKey(e.starts_at, timeZone)) ?? []), e]);
  const late = open.filter((r) => r.promised_at && new Date(r.promised_at).getTime() < now);
  const noDate = open.filter((r) => !r.promised_at);
  const upcomingDays = [...new Set([...dueOn.keys(), ...eventsOn.keys()])].filter((k) => k >= today).sort();
  const eventsToday = (eventsOn.get(today) ?? []).filter((e) => !e.done_at).length;
  // entradas de um dia, na ordem do horário (dia todo primeiro)
  const entriesOf = (key: string, opts: { onlyUpcoming?: boolean } = {}): Entry[] =>
    [
      ...(dueOn.get(key) ?? [])
        .filter((r) => !opts.onlyUpcoming || new Date(r.promised_at!).getTime() >= now)
        .map((r): Entry => ({ kind: 'demand', r })),
      ...(eventsOn.get(key) ?? []).map((e): Entry => ({ kind: 'event', e })),
    ].sort((a, b) => entryTime(a) - entryTime(b));
  const demandEntries = (rows: Row[], done = false) => rows.map((r): Entry => ({ kind: 'demand', r, done }));

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

  const eventItem = (e: AgendaEvent) => (
    <li key={e.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5', e.done_at && 'opacity-60')}>
      <span className="tabular w-12 shrink-0 text-xs font-semibold text-series-1">{e.all_day ? 'dia todo' : formatTime(e.starts_at, timeZone)}</span>
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn('line-clamp-2 text-sm font-medium', e.done_at && 'line-through')}>
          <CalendarClock className="mr-1 inline h-3.5 w-3.5 text-series-1" aria-hidden />
          {e.title}
        </p>
        <p className="line-clamp-2 text-xs text-ink-2">{e.notes || 'Compromisso'}</p>
      </div>
      {e.done_at && <span className="text-[11px] font-medium text-good-ink">concluído</span>}
      <EventActions event={e} personName={personName} timeZone={timeZone} />
    </li>
  );

  const section = (title: React.ReactNode, entries: Entry[], opts: { tone?: 'critical' | 'good' } = {}) =>
    entries.length > 0 && (
      <Card key={String(title)} className="overflow-hidden">
        <h2
          className={cn(
            'flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-semibold sm:px-5',
            opts.tone === 'critical' && 'text-critical-ink',
            opts.tone === 'good' && 'text-good-ink',
          )}
        >
          {title} <span className="tabular rounded-full bg-surface-2 px-2 text-[11px] font-semibold text-ink-2">{entries.length}</span>
        </h2>
        <ul className="divide-y divide-line">
          {entries.map((x) => (x.kind === 'event' ? eventItem(x.e) : item(x.r, { done: x.done })))}
        </ul>
      </Card>
    );

  return (
    <>
      <PageHeader
        title="Agenda"
        description="As demandas para entregar em cada dia, pelo prazo prometido, e os seus compromissos. Só o responsável marca a entrega, pelo botão “Demanda entregue”."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <PersonSelect
                value={ids.length === 1 && (viewingOther || !myIds.length) ? ids[0] : ''}
                mine={myIds.length > 0}
                people={people.map((p) => ({ id: p.id, name: p.active ? p.name : `${p.name} (inativo)` }))}
              />
            )}
            {ids.length > 0 && (
              <NewEventButton memberId={ids[0]} personName={viewingOther ? personName : null} timeZone={timeZone} defaultDate={day ?? today} />
            )}
          </div>
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
                  const evs = eventsOn.get(key)?.filter((e) => !e.done_at).length ?? 0;
                  const past = key < today;
                  return (
                    <Link
                      key={key}
                      href={href({ dia: day === key ? null : key })}
                      aria-label={`${i + 1}: ${due} a entregar, ${evs} compromisso(s), ${done} entregue(s)`}
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
                        {evs > 0 && <span className="h-1.5 w-1.5 rounded-full bg-series-1" aria-hidden />}
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
                  <span className="h-2 w-2 rounded-full bg-series-1" /> compromisso
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-good" /> entregue
                </span>
              </p>
            </Card>
            <Card className="grid grid-cols-4 divide-x divide-line text-center">
              <div className="p-3">
                <p className="tabular text-xl font-semibold text-critical-ink">{late.length}</p>
                <p className="text-[11px] text-ink-2">atrasadas</p>
              </div>
              <div className="p-3">
                <p className="tabular text-xl font-semibold">{dueOn.get(today)?.filter((r) => new Date(r.promised_at!).getTime() >= now).length ?? 0}</p>
                <p className="text-[11px] text-ink-2">para hoje</p>
              </div>
              <div className="p-3">
                <p className="tabular text-xl font-semibold text-series-1">{eventsToday}</p>
                <p className="text-[11px] text-ink-2">compromissos hoje</p>
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
                    <CalendarDays className="h-4 w-4" /> {dayTitle(day, today)}
                  </>,
                  entriesOf(day),
                  { tone: day < today ? 'critical' : undefined },
                )}
                {section(
                  <>
                    <CheckCircle2 className="h-4 w-4" /> {dayTitle(day, today)} · entregues
                  </>,
                  demandEntries(doneOn.get(day) ?? [], true),
                  { tone: 'good' },
                )}
                {!dueOn.get(day)?.length && !doneOn.get(day)?.length && !eventsOn.get(day)?.length && (
                  <Card>
                    <EmptyState icon={<CalendarDays />} title="Nada neste dia" description="Nenhuma demanda ou compromisso neste dia. Use “Novo compromisso” para registrar um." />
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
                  demandEntries(late),
                  { tone: 'critical' },
                )}
                {upcomingDays.map((k) =>
                  section(
                    <>
                      <CalendarDays className="h-4 w-4" /> {dayTitle(k, today)}
                    </>,
                    entriesOf(k, { onlyUpcoming: true }),
                  ),
                )}
                {section(
                  <>
                    <Clock className="h-4 w-4" /> Sem prazo definido
                  </>,
                  demandEntries(noDate),
                )}
                {section(
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Entregues hoje
                  </>,
                  demandEntries(doneOn.get(today) ?? [], true),
                  { tone: 'good' },
                )}
                {!open.length && !doneOn.get(today)?.length && !upcomingDays.length && (
                  <Card>
                    <EmptyState
                      icon={<CheckCircle2 />}
                      title="Agenda livre"
                      description="Quando uma demanda tiver este responsável, ela aparece aqui no dia do prazo prometido. Compromissos são registrados em “Novo compromisso”."
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
