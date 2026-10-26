import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemandStatusBadge } from '@/components/demands/status';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { cn, formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Demand } from '@/lib/types';
import { DeliverButton, PersonSelect } from './agenda-controls';
import { EventActions, EventDetails, NewEventButton, type AgendaEvent } from './event-controls';

export const metadata: Metadata = { title: 'Monitor Group · Agenda' };

type Row = Demand & { groups: { name: string } | null; team_members: { name: string } | null };
/** uma linha da agenda: demanda (a entregar ou entregue) ou compromisso */
type Entry = { kind: 'demand'; r: Row; done?: boolean } | { kind: 'event'; e: AgendaEvent };
type View = 'dia' | 'semana' | 'mes';

const VIEWS: { key: View; label: string }[] = [
  { key: 'dia', label: 'Dia' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mês' },
];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10-21" no fuso da empresa */
const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const parts = (key: string) => key.split('-').map(Number) as [number, number, number];
const addDays = (key: string, n: number) => {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (key: string) => {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const ddmm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const entryTime = (x: Entry) =>
  x.kind === 'event'
    ? x.e.all_day
      ? 0
      : new Date(x.e.starts_at).getTime()
    : new Date((x.done ? x.r.delivered_at : x.r.promised_at) ?? 0).getTime();

/**
 * Agenda: as demandas que a pessoa tem para entregar (pelo prazo prometido) e os compromissos
 * registrados à mão, por dia, semana ou mês. Cada usuário vê a própria (a pessoa da equipe ligada
 * ao e-mail de acesso dele); administradores escolhem qualquer pessoa da equipe.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireMenu('/agenda');
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: myIdsRaw }, { data: team }, { data: settings }, { data: peopleRaw }, { data: teamsRaw }] = await Promise.all([
    supabase.rpc('my_team_member_ids'),
    supabase.from('team_members').select('id, name, active').order('name'),
    supabase.from('app_settings').select('timezone').maybeSingle(),
    // usuários da empresa (agenda por usuário, 0097) e os setores da agenda
    supabase.rpc('agenda_people'),
    supabase.from('agenda_teams').select('id, name, agenda_team_members(user_id)').order('name'),
  ]);
  const people = ((peopleRaw ?? []) as { id: string; name: string; role: string; member_ids: string[] }[]) ?? [];
  const agendaTeams = ((teamsRaw ?? []) as { id: string; name: string; agenda_team_members: { user_id: string }[] }[]).map((t) => ({
    id: t.id,
    name: t.name,
    userIds: t.agenda_team_members.map((m) => m.user_id),
  }));
  // a própria agenda: a pessoa da equipe ligada ao e-mail de acesso; sem a ligação, a de mesmo nome
  const norm = (v: string | null | undefined) =>
    (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const linked = Array.isArray(myIdsRaw) ? (myIdsRaw as string[]) : [];
  const myName = norm(profile.full_name);
  const myIds = linked.length
    ? linked
    : myName
      ? (team ?? []).filter((t) => t.active && norm(t.name) === myName).map((t) => t.id as string)
      : [];
  const timeZone = settings?.timezone ?? 'America/Sao_Paulo';
  const nowIso = new Date().toISOString();
  const now = new Date(nowIso).getTime();
  const today = dayKey(nowIso, timeZone);

  // de quem é a agenda: a do próprio usuário; administrador escolhe outro usuário (?quem=)
  const wanted = typeof sp.quem === 'string' && isAdmin && people.some((p) => p.id === sp.quem) ? sp.quem : null;
  const userId = wanted ?? profile.id;
  const viewingOther = userId !== profile.id;
  const person = people.find((p) => p.id === userId);
  const personName = person?.name ?? profile.full_name ?? profile.email;
  // demandas na agenda: as da pessoa da equipe ligada a esse usuário
  const ids = viewingOther ? (person?.member_ids ?? []) : myIds;
  void team;

  // compromisso aberto (?evento=, da notificação ou de um clique): detalhes e a agenda no dia dele
  const EVENT_COLS = 'id, member_id, owner_id, created_by, title, notes, starts_at, all_day, done_at, reminders';
  let opened: AgendaEvent | null = null;
  if (typeof sp.evento === 'string' && /^[0-9a-f-]{36}$/i.test(sp.evento)) {
    const [{ data: ev }, { data: ppl }] = await Promise.all([
      supabase.from('agenda_events').select(EVENT_COLS).eq('id', sp.evento).maybeSingle(),
      supabase.from('agenda_event_people').select('user_id').eq('event_id', sp.evento),
    ]);
    if (ev) opened = { ...(ev as AgendaEvent), people: ((ppl ?? []) as { user_id: string }[]).map((r) => r.user_id) };
  }

  // visão e data de referência (links antigos: ?dia= e ?mes=)
  const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const view: View =
    sp.vista === 'dia' || sp.vista === 'semana' || sp.vista === 'mes'
      ? sp.vista
      : isDay(sp.dia) || (opened && !isDay(sp.data))
        ? 'dia'
        : typeof sp.mes === 'string'
          ? 'mes'
          : 'semana';
  const ref = isDay(sp.data)
    ? sp.data
    : isDay(sp.dia)
      ? sp.dia
      : typeof sp.mes === 'string' && /^\d{4}-\d{2}$/.test(sp.mes)
        ? `${sp.mes}-01`
        : opened
          ? dayKey(opened.starts_at, timeZone)
          : today;
  const [ry, rm] = parts(ref);

  // período mostrado (mês: a grade vai de domingo a sábado)
  const monthFirst = `${ref.slice(0, 7)}-01`;
  const monthLast = new Date(Date.UTC(ry, rm, 0)).toISOString().slice(0, 10);
  const range =
    view === 'dia'
      ? { start: ref, end: ref }
      : view === 'semana'
        ? { start: addDays(ref, -weekday(ref)), end: addDays(ref, 6 - weekday(ref)) }
        : { start: addDays(monthFirst, -weekday(monthFirst)), end: addDays(monthLast, 6 - weekday(monthLast)) };
  const days: string[] = [];
  for (let k = range.start; k <= range.end; k = addDays(k, 1)) days.push(k);

  let open: Row[] = [];
  let delivered: Row[] = [];
  let events: AgendaEvent[] = [];
  {
    // o período e hoje (o resumo é sempre de hoje), com folga por causa do fuso
    const from = addDays(range.start < today ? range.start : today, -1);
    const until = addDays(range.end > today ? range.end : today, 2);
    const none = Promise.resolve({ data: [] as unknown[] });
    const [o, d, ev, evOld] = await Promise.all([
      supabase
        .from('demands')
        .select('*, groups(name), team_members(name)')
        .in('assignee_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
        .in('status', ['aberta', 'em_andamento'])
        .order('promised_at', { ascending: true, nullsFirst: false })
        .limit(1000),
      supabase
        .from('demands')
        .select('*, groups(name), team_members(name)')
        .in('assignee_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
        .eq('status', 'entregue')
        .gte('delivered_at', `${from}T00:00:00Z`)
        .lt('delivered_at', `${until}T00:00:00Z`)
        .order('delivered_at', { ascending: false })
        .limit(1000),
      // compromissos do período em que o usuário participa (0097)
      supabase
        .from('agenda_events')
        .select(`${EVENT_COLS}, agenda_event_people!inner(user_id)`)
        .eq('agenda_event_people.user_id', userId)
        .gte('starts_at', `${from}T00:00:00Z`)
        .lt('starts_at', `${until}T00:00:00Z`)
        .order('starts_at')
        .limit(1000),
      // compromissos antigos, da pessoa da equipe ligada
      ids.length
        ? supabase
            .from('agenda_events')
            .select(EVENT_COLS)
            .in('member_id', ids)
            .gte('starts_at', `${from}T00:00:00Z`)
            .lt('starts_at', `${until}T00:00:00Z`)
            .order('starts_at')
            .limit(1000)
        : none,
    ]);
    open = (o.data ?? []) as Row[];
    delivered = (d.data ?? []) as Row[];
    const byId = new Map<string, AgendaEvent>();
    for (const e of [...((ev.data ?? []) as AgendaEvent[]), ...((evOld.data ?? []) as AgendaEvent[])]) byId.set(e.id, { ...e, people: [] });
    // participantes de cada compromisso (para mostrar e editar)
    if (byId.size) {
      const { data: ppl } = await supabase.from('agenda_event_people').select('event_id, user_id').in('event_id', [...byId.keys()]);
      for (const r of (ppl ?? []) as { event_id: string; user_id: string }[]) byId.get(r.event_id)?.people?.push(r.user_id);
    }
    events = [...byId.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  const groupByDay = <T,>(rows: T[], when: (r: T) => string | null) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const w = when(r);
      if (!w) continue;
      const k = dayKey(w, timeZone);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return map;
  };
  const dueOn = groupByDay(open, (r) => r.promised_at);
  const doneOn = groupByDay(delivered, (r) => r.delivered_at);
  const eventsOn = groupByDay(events, (e) => e.starts_at);
  const isLate = (r: Row) => Boolean(r.promised_at && new Date(r.promised_at).getTime() < now);
  const late = open.filter(isLate);
  const noDate = open.filter((r) => !r.promised_at);

  /** tudo de um dia, na ordem do horário (dia todo primeiro) */
  const entriesOf = (key: string): Entry[] =>
    [
      ...(dueOn.get(key) ?? []).map((r): Entry => ({ kind: 'demand', r })),
      ...(eventsOn.get(key) ?? []).map((e): Entry => ({ kind: 'event', e })),
      ...(doneOn.get(key) ?? []).map((r): Entry => ({ kind: 'demand', r, done: true })),
    ].sort((a, b) => entryTime(a) - entryTime(b));
  const demandEntries = (rows: Row[]) => rows.map((r): Entry => ({ kind: 'demand', r }));

  const href = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { quem: isAdmin ? wanted : null, vista: view, data: ref === today ? null : ref };
    for (const [k, v] of Object.entries({ ...cur, ...changes })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/agenda?${s}` : '/agenda';
  };
  const step = (dir: -1 | 1) => {
    if (view === 'dia') return addDays(ref, dir);
    if (view === 'semana') return addDays(ref, 7 * dir);
    return new Date(Date.UTC(ry, rm - 1 + dir, 1)).toISOString().slice(0, 10);
  };
  const periodLabel =
    view === 'dia'
      ? `${WEEKDAYS_LONG[weekday(ref)]}, ${parts(ref)[2]} de ${MONTHS[rm - 1]}${ref === today ? ' · hoje' : ''}`
      : view === 'semana'
        ? `${ddmm(range.start)} a ${ddmm(range.end)} de ${parts(range.end)[0]}`
        : `${MONTHS[rm - 1]} de ${ry}`;
  const isCurrent = view === 'dia' ? ref === today : view === 'semana' ? today >= range.start && today <= range.end : ref.slice(0, 7) === today.slice(0, 7);
  const canDeliver = (r: Row) => Boolean(r.assignee_id && myIds.includes(r.assignee_id));

  // ---------- linhas completas (dia e listas)
  const demandItem = (r: Row, done = false) => {
    const overdue = !done && isLate(r);
    return (
      <li key={`${r.id}${done ? 'd' : ''}`} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <span className={cn('tabular w-14 shrink-0 text-xs font-semibold', done ? 'text-good-ink' : overdue ? 'text-critical-ink' : 'text-ink-2')}>
          {done ? r.delivered_at && formatTime(r.delivered_at, timeZone) : r.promised_at ? formatTime(r.promised_at, timeZone) : '—'}
        </span>
        <Link href={`/demands?id=${r.id}`} className="min-w-0 flex-1 basis-56 hover:underline">
          <p className="line-clamp-2 text-sm font-medium">
            <span className="text-muted">#{r.number}</span> {r.description}
          </p>
          <p className="truncate text-xs text-ink-2">
            {r.groups?.name ?? 'grupo de outro setor'}
            {overdue && <span className="ml-2 font-medium text-critical-ink">prazo vencido</span>}
            {done && <span className="ml-2 font-medium text-good-ink">entregue</span>}
          </p>
        </Link>
        <DemandStatusBadge status={r.status} />
        {!done && canDeliver(r) && <DeliverButton id={r.id} number={r.number} />}
      </li>
    );
  };
  const eventItem = (e: AgendaEvent) => (
    <li key={e.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5', e.done_at && 'opacity-60')}>
      <span className="tabular w-14 shrink-0 text-xs font-semibold text-series-1">{e.all_day ? 'dia todo' : formatTime(e.starts_at, timeZone)}</span>
      <Link href={href({ evento: e.id })} scroll={false} className="min-w-0 flex-1 basis-56 hover:underline" title="Ver detalhes">
        <p className={cn('line-clamp-2 text-sm font-medium', e.done_at && 'line-through')}>
          <CalendarClock className="mr-1 inline h-3.5 w-3.5 text-series-1" aria-hidden />
          {e.title}
        </p>
        <p className="line-clamp-2 text-xs text-ink-2">{e.notes || 'Compromisso'}</p>
        {(e.people?.length ?? 0) > 1 && (
          <p className="mt-0.5 truncate text-[11px] text-muted" title="Participantes">
            👥 {(e.people ?? []).map((id) => people.find((p) => p.id === id)?.name ?? 'usuário').join(', ')}
          </p>
        )}
      </Link>
      {e.done_at && <span className="text-[11px] font-medium text-good-ink">concluído</span>}
      <EventActions event={e} timeZone={timeZone} people={pickPeople} teams={agendaTeams} />
    </li>
  );
  const section = (key: string, title: React.ReactNode, entries: Entry[], tone?: 'critical') =>
    entries.length > 0 && (
      <Card key={key} className="overflow-hidden">
        <h2 className={cn('flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-semibold sm:px-5', tone === 'critical' && 'text-critical-ink')}>
          {title} <span className="tabular rounded-full bg-surface-2 px-2 text-[11px] font-semibold text-ink-2">{entries.length}</span>
        </h2>
        <ul className="divide-y divide-line">{entries.map((x) => (x.kind === 'event' ? eventItem(x.e) : demandItem(x.r, x.done)))}</ul>
      </Card>
    );

  // ---------- itens compactos (semana e mês)
  const chip = (x: Entry) => {
    if (x.kind === 'event') {
      const e = x.e;
      return (
        <Link
          key={e.id}
          href={href({ evento: e.id })}
          scroll={false}
          title={`${e.all_day ? 'Dia todo' : formatTime(e.starts_at, timeZone)} · ${e.title}${e.notes ? ` · ${e.notes}` : ''}`}
          className={cn(
            'block truncate rounded-md border-l-2 border-series-1 bg-series-1/10 px-1.5 py-0.5 text-[11px] text-ink hover:bg-series-1/20',
            e.done_at && 'line-through opacity-60',
          )}
        >
          <span className="tabular font-semibold text-series-1">{e.all_day ? '' : `${formatTime(e.starts_at, timeZone)} `}</span>
          {e.title}
        </Link>
      );
    }
    const r = x.r;
    const done = Boolean(x.done);
    const overdue = !done && isLate(r);
    return (
      <Link
        key={`${r.id}${done ? 'd' : ''}`}
        href={`/demands?id=${r.id}`}
        title={`#${r.number} ${r.description} · ${r.groups?.name ?? ''}${done ? ' · entregue' : overdue ? ' · prazo vencido' : ''}`}
        className={cn(
          'block truncate rounded-md border-l-2 px-1.5 py-0.5 text-[11px] text-ink',
          done
            ? 'border-good bg-good/10 hover:bg-good/20'
            : overdue
              ? 'border-critical bg-critical/10 hover:bg-critical/20'
              : 'border-warning bg-warning/15 hover:bg-warning/25',
        )}
      >
        <span className={cn('tabular font-semibold', done ? 'text-good-ink' : overdue ? 'text-critical-ink' : 'text-warning-ink')}>
          {done ? '✓ ' : r.promised_at ? `${formatTime(r.promised_at, timeZone)} ` : ''}
        </span>
        #{r.number} {r.description}
      </Link>
    );
  };

  const legend = (
    <p className="flex flex-wrap gap-3 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-warning" /> demanda a entregar
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
  );

  // quem pode ser chamado para um compromisso: os usuários ativos da empresa
  const pickPeople = people.map((p) => ({ id: p.id, name: p.name }));
  const todayDue = (dueOn.get(today) ?? []).filter((r) => !isLate(r)).length;
  const todayEvents = (eventsOn.get(today) ?? []).filter((e) => !e.done_at).length;
  const dayEntries = view === 'dia' ? entriesOf(ref) : [];

  const personSelect = isAdmin && <PersonSelect value={viewingOther ? userId : ''} people={people.map((p) => ({ id: p.id, name: p.name }))} />;

  return (
    <div data-wide>
      <PageHeader
        title="Agenda"
        description="Os seus compromissos (e os marcados para você) e as demandas para entregar, por dia, semana ou mês."
      />

      {opened && (
        <EventDetails
          key={opened.id}
          event={opened}
          timeZone={timeZone}
          people={pickPeople}
          teams={agendaTeams}
          ownerName={people.find((p) => p.id === (opened.owner_id ?? opened.created_by))?.name ?? null}
          past={!opened.all_day && new Date(opened.starts_at).getTime() < now}
        />
      )}
      {
        <div className="space-y-4">
          {/* visão, período e resumo de hoje */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Visão da agenda">
                {VIEWS.map((v) => (
                  <Link
                    key={v.key}
                    role="tab"
                    aria-selected={view === v.key}
                    href={href({ vista: v.key })}
                    className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', view === v.key ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}
                  >
                    {v.label}
                  </Link>
                ))}
              </div>
              <div className="inline-flex items-center rounded-xl border border-line bg-surface">
                <Link href={href({ data: step(-1) })} className="rounded-l-xl p-2 text-ink-2 hover:bg-surface-2" aria-label="Anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <Link
                  href={href({ data: null })}
                  className={cn('border-x border-line px-3 py-1.5 text-xs font-medium', isCurrent ? 'text-muted' : 'text-ink hover:bg-surface-2')}
                >
                  Hoje
                </Link>
                <Link href={href({ data: step(1) })} className="rounded-r-xl p-2 text-ink-2 hover:bg-surface-2" aria-label="Próximo">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <h2 className="text-base font-semibold first-letter:uppercase">{periodLabel}</h2>
              {/* responsável e novo compromisso: na mesma linha, à direita */}
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {personSelect}
                <NewEventButton
                  defaultPeople={[userId]}
                  people={pickPeople}
                  teams={agendaTeams}
                  personName={viewingOther ? personName : null}
                  timeZone={timeZone}
                  defaultDate={view === 'dia' || ref >= today ? ref : today}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {personName && (
                <span className="mr-1 text-ink-2">
                  Agenda de <strong className="text-ink">{personName}</strong>
                </span>
              )}
              <span className="rounded-full bg-critical/12 px-2.5 py-1 font-medium text-critical-ink">{late.length} atrasada(s)</span>
              <span className="rounded-full bg-warning/15 px-2.5 py-1 font-medium text-warning-ink">{todayDue} para hoje</span>
              <span className="rounded-full bg-series-1/12 px-2.5 py-1 font-medium text-series-1">{todayEvents} compromisso(s) hoje</span>
              <span className="rounded-full bg-good/15 px-2.5 py-1 font-medium text-good-ink">{doneOn.get(today)?.length ?? 0} entregue(s) hoje</span>
            </div>
          </div>

          {view === 'dia' &&
            (dayEntries.length ? (
              section(
                'dia',
                <>
                  <CalendarDays className="h-4 w-4" /> {ref === today ? 'Hoje' : `${WEEKDAYS[weekday(ref)]}, ${ddmm(ref)}`}
                </>,
                dayEntries,
              )
            ) : (
              <Card>
                <EmptyState
                  icon={<CalendarDays />}
                  title="Nada neste dia"
                  description="Nenhuma demanda ou compromisso neste dia. Use “Novo compromisso” para registrar um."
                />
              </Card>
            ))}

          {view === 'semana' && (
            <Card className="overflow-hidden">
              <div className="grid divide-y divide-line md:grid-cols-7 md:divide-x md:divide-y-0">
                {days.map((k) => {
                  const list = entriesOf(k);
                  return (
                    <div key={k} className={cn('min-w-0 p-2 md:min-h-[22rem]', k === today && 'bg-brand-soft/40')}>
                      <Link
                        href={href({ vista: 'dia', data: k })}
                        className={cn(
                          'mb-2 flex items-baseline justify-between rounded-lg px-1.5 py-1 text-xs hover:bg-surface-2',
                          k === today ? 'font-semibold text-brand-text' : 'text-ink-2',
                        )}
                      >
                        <span>{WEEKDAYS[weekday(k)]}</span>
                        <span className="tabular text-sm font-semibold">{ddmm(k)}</span>
                      </Link>
                      <div className="space-y-1">
                        {list.map(chip)}
                        {!list.length && <p className="px-1.5 text-[11px] text-muted md:hidden">Livre</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-line px-4 py-2">{legend}</div>
            </Card>
          )}

          {view === 'mes' && (
            <Card className="overflow-hidden">
              <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-medium text-muted">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="py-2">
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((k, i) => {
                  const list = entriesOf(k);
                  const inMonth = k >= monthFirst && k <= monthLast;
                  const max = 3;
                  return (
                    <div
                      key={k}
                      className={cn(
                        'min-h-20 min-w-0 border-line p-1 sm:min-h-28 sm:p-1.5',
                        i % 7 !== 6 && 'border-r',
                        i < days.length - 7 && 'border-b',
                        !inMonth && 'bg-surface-2/50',
                        k === today && 'bg-brand-soft/40',
                      )}
                    >
                      <Link
                        href={href({ vista: 'dia', data: k })}
                        className={cn(
                          'tabular mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs hover:bg-surface-2',
                          k === today ? 'bg-brand font-semibold text-brand-ink' : inMonth ? 'text-ink' : 'text-muted',
                        )}
                        aria-label={`${ddmm(k)}: ${list.length} item(ns)`}
                      >
                        {parts(k)[2]}
                      </Link>
                      {/* celular: só a quantidade; telas maiores: os itens */}
                      {list.length > 0 && (
                        <Link href={href({ vista: 'dia', data: k })} className="block sm:hidden">
                          <span className="tabular rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-ink-2">{list.length}</span>
                        </Link>
                      )}
                      <div className="hidden space-y-0.5 sm:block">
                        {list.slice(0, max).map(chip)}
                        {list.length > max && (
                          <Link href={href({ vista: 'dia', data: k })} className="block px-1.5 text-[11px] font-medium text-brand-text hover:underline">
                            +{list.length - max} mais
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-line px-4 py-2">{legend}</div>
            </Card>
          )}

          {/* pendências fora do período: atrasadas e sem prazo */}
          {(late.length > 0 || noDate.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {section(
                'atrasadas',
                <>
                  <AlertTriangle className="h-4 w-4" /> Atrasadas
                </>,
                demandEntries(late),
                'critical',
              )}
              {section(
                'sem-prazo',
                <>
                  <Clock className="h-4 w-4" /> Sem prazo definido
                </>,
                demandEntries(noDate),
              )}
            </div>
          )}
          {!open.length && !events.length && !delivered.length && view !== 'dia' && (
            <Card>
              <EmptyState
                icon={<CheckCircle2 />}
                title="Agenda livre"
                description="Quando uma demanda tiver este responsável, ela aparece aqui no dia do prazo prometido. Compromissos são registrados em “Novo compromisso”."
              />
            </Card>
          )}
        </div>
      }
    </div>
  );
}
