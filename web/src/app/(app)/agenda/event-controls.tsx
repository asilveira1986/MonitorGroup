'use client';

import { Bell, CalendarClock, Check, Clock, Pencil, Plus, RotateCcw, StickyNote, Trash2, UserRound, Users, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, Textarea, Toggle } from '@/components/ui';
import { createAgendaEvent, deleteAgendaEvent, setAgendaEventDone, updateAgendaEvent } from './actions';

export type AgendaEvent = {
  id: string;
  member_id: string | null;
  owner_id?: string | null;
  created_by?: string | null;
  /** participantes (usuários, 0097) */
  people?: string[];
  title: string;
  notes: string | null;
  starts_at: string;
  all_day: boolean;
  done_at: string | null;
  /** lembretes: minutos antes (0101) */
  reminders?: number[];
};

/** opções de lembrete (minutos antes; no dia todo, antes das 8h do dia) */
const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 180, 1440, 2880, 10080];
const MAX_REMINDERS = 5;

export function reminderLabel(m: number, allDay = false) {
  if (allDay) {
    if (m < 1440) return m === 0 ? 'No dia, às 8h' : `No dia, ${m < 60 ? `${m} min` : `${m / 60} h`} antes das 8h`;
    return m === 1440 ? 'Na véspera, às 8h' : m % 10080 === 0 ? `${m / 10080} semana(s) antes, às 8h` : `${m / 1440} dias antes, às 8h`;
  }
  if (m === 0) return 'Na hora';
  if (m < 60) return `${m} min antes`;
  if (m < 1440) return `${m / 60} hora${m >= 120 ? 's' : ''} antes`;
  if (m % 10080 === 0) return `${m / 10080} semana${m >= 20160 ? 's' : ''} antes`;
  return `${m / 1440} dia${m >= 2880 ? 's' : ''} antes`;
}

/** Lembretes do compromisso: um ou mais, cada um com o tempo antes (notificação no celular). */
function RemindersPicker({ value, onChange, allDay }: { value: number[]; onChange: (v: number[]) => void; allDay: boolean }) {
  const free = REMINDER_OPTIONS.filter((m) => !value.includes(m));
  const set = (i: number, m: number) => onChange([...new Set(value.map((v, k) => (k === i ? m : v)))].sort((a, b) => a - b));
  return (
    <div className="space-y-2">
      {value.map((m, i) => (
        <div key={m} className="flex items-center gap-2">
          <Bell className="h-4 w-4 shrink-0 text-series-1" aria-hidden />
          <select
            value={m}
            onChange={(e) => set(i, Number(e.target.value))}
            aria-label={`Lembrete ${i + 1}`}
            className="h-10 flex-1 rounded-xl border border-line bg-surface px-3 text-base text-ink outline-none focus:border-brand-line sm:h-9 sm:text-sm"
          >
            {[m, ...free].sort((a, b) => a - b).map((o) => (
              <option key={o} value={o}>
                {reminderLabel(o, allDay)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== m))}
            className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 hover:text-critical-ink"
            aria-label="Tirar este lembrete"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {value.length < MAX_REMINDERS && free.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([...value, free.find((m) => m > (value[value.length - 1] ?? -1)) ?? free[0]].sort((a, b) => a - b))}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-2 hover:border-brand-line hover:text-ink"
          >
            <Plus className="h-3 w-3" /> Adicionar lembrete
          </button>
        )}
        <span className="text-[11px] text-muted">
          {value.length ? 'Notificação no celular/computador de cada participante.' : 'Sem lembrete.'}
        </span>
      </div>
    </div>
  );
}

/** diferença (ms) entre o relógio do fuso e o UTC naquele instante */
function tzOffset(ts: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(ts))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

/** "2026-10-21" + "14:30" no fuso da empresa → ISO */
function zonedIso(date: string, time: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi);
  return new Date(guess - tzOffset(guess, timeZone)).toISOString();
}

function zonedParts(iso: string, timeZone: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
}

export type Person = { id: string; name: string };
export type AgendaTeam = { id: string; name: string; userIds: string[] };

/**
 * Quem participa: escolher um setor da agenda marca todos dele (e dá para desmarcar um a um);
 * também dá para marcar qualquer pessoa da empresa.
 */
function PeoplePicker({
  people,
  teams,
  value,
  onChange,
}: {
  people: Person[];
  teams: AgendaTeam[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const has = new Set(value);
  const shown = people.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {teams.map((t) => {
          const all = t.userIds.length > 0 && t.userIds.every((id) => has.has(id));
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(all ? value.filter((id) => !t.userIds.includes(id)) : [...new Set([...value, ...t.userIds])])}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${all ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:border-brand-line'}`}
              title={all ? 'Tirar todos deste setor' : 'Marcar todos deste setor'}
            >
              <Users className="h-3 w-3" /> {t.name} <span className="text-muted">({t.userIds.length})</span>
            </button>
          );
        })}
        <button type="button" onClick={() => onChange(people.map((p) => p.id))} className="rounded-full px-2 py-1 text-xs text-brand-text hover:underline">
          todos
        </button>
        <button type="button" onClick={() => onChange([])} className="rounded-full px-2 py-1 text-xs text-ink-2 hover:underline">
          ninguém
        </button>
      </div>
      {people.length > 8 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" className="h-8 text-xs" />}
      <div className="max-h-44 overflow-y-auto rounded-xl border border-line p-1">
        {shown.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <input
              type="checkbox"
              checked={has.has(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((id) => id !== p.id))}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            {p.name}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-muted">{value.length ? `${value.length} pessoa(s) — aparece na agenda de cada uma` : 'Ninguém marcado: fica só na sua agenda.'}</p>
    </div>
  );
}

function EventDialog({
  defaultPeople,
  people,
  teams,
  personName,
  timeZone,
  defaultDate,
  event,
  onClose,
}: {
  defaultPeople: string[];
  people: Person[];
  teams: AgendaTeam[];
  personName: string | null;
  timeZone: string;
  defaultDate: string;
  event?: AgendaEvent;
  onClose: () => void;
}) {
  const router = useRouter();
  const initial = event ? zonedParts(event.starts_at, timeZone) : { date: defaultDate, time: '09:00' };
  const [title, setTitle] = useState(event?.title ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(event?.all_day ? '09:00' : initial.time);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [who, setWho] = useState<string[]>(event?.people?.length ? event.people : defaultPeople);
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? [15]);
  // dia todo: o padrão passa a ser "no dia, às 8h" (se ainda estava no padrão)
  const changeAllDay = (on: boolean) => {
    setAllDay(on);
    if (!event && reminders.length === 1 && reminders[0] === (on ? 15 : 0)) setReminders([on ? 0 : 15]);
  };
  const [pending, start] = useTransition();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return void toast.error('Informe a data do compromisso.');
    // dia todo: meio-dia no fuso da empresa, para o dia não mudar com o fuso
    const startsAt = zonedIso(date, allDay ? '12:00' : time || '09:00', timeZone);
    const values = { people: who, title, notes, startsAt, allDay, reminders };
    start(async () => {
      const res = event ? await updateAgendaEvent(event.id, values) : await createAgendaEvent(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success(event ? 'Compromisso atualizado' : 'Compromisso registrado na agenda');
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Compromisso">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={submit} className="relative max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{event ? 'Editar compromisso' : 'Novo compromisso'}</h2>
            {personName && <p className="text-xs text-ink-2">Na agenda de {personName}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Field label="Título">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Reunião com o cliente, audiência, ligar para..."
            maxLength={200}
            required
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Hora">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={allDay} />
          </Field>
        </div>
        <Toggle checked={allDay} onChange={changeAllDay} label="Dia todo (sem horário)" />
        <Field label="Lembretes">
          <RemindersPicker value={reminders} onChange={setReminders} allDay={allDay} />
        </Field>
        <Field label="Participantes">
          <PeoplePicker people={people} teams={teams} value={who} onChange={setWho} />
        </Field>
        <Field label="Observação (opcional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Local, link, detalhes..." />
        </Field>
        <div className="flex gap-2">
          <Button disabled={pending}>{pending ? 'Salvando…' : event ? 'Salvar' : 'Registrar compromisso'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Botão "Novo compromisso" (na agenda mostrada). */
export function NewEventButton(props: {
  defaultPeople: string[];
  people: Person[];
  teams: AgendaTeam[];
  personName: string | null;
  timeZone: string;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Novo compromisso
      </Button>
      {open && <EventDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Concluir, editar e excluir um compromisso. */
export function EventActions({
  event,
  timeZone,
  people,
  teams,
  labels = false,
}: {
  event: AgendaEvent;
  timeZone: string;
  people: Person[];
  teams: AgendaTeam[];
  /** com o nome em cada botão (detalhes do compromisso) */
  labels?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? 'Erro ao salvar');
      toast.success(ok);
      router.refresh();
    });
  const btn = 'inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-surface-2 disabled:opacity-50';
  return (
    <div className="flex items-center gap-1">
      {event.done_at ? (
        <button type="button" disabled={pending} className={`${btn} text-ink-2`} onClick={() => run(() => setAgendaEventDone(event.id, false), 'Compromisso reaberto')}>
          <RotateCcw className="h-3.5 w-3.5" /> Reabrir
        </button>
      ) : (
        <button type="button" disabled={pending} className={`${btn} text-good-ink`} onClick={() => run(() => setAgendaEventDone(event.id, true), 'Compromisso concluído')}>
          <Check className="h-3.5 w-3.5" /> Concluir
        </button>
      )}
      <button type="button" disabled={pending} className={`${btn} text-ink-2`} onClick={() => setEditing(true)} aria-label="Editar compromisso">
        <Pencil className="h-3.5 w-3.5" /> {labels && 'Editar'}
      </button>
      <button
        type="button"
        disabled={pending}
        className={`${btn} text-critical-ink`}
        aria-label="Excluir compromisso"
        onClick={() => confirm(`Excluir o compromisso "${event.title}"?`) && run(() => deleteAgendaEvent(event.id), 'Compromisso excluído')}
      >
        <Trash2 className="h-3.5 w-3.5" /> {labels && 'Excluir'}
      </button>
      {editing && (
        <EventDialog
          defaultPeople={event.people ?? []}
          people={people}
          teams={teams}
          personName={null}
          timeZone={timeZone}
          defaultDate={zonedParts(event.starts_at, timeZone).date}
          event={event}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * Detalhes do compromisso (/agenda?evento=...): abre ao tocar na notificação da agenda ou no
 * compromisso; mostra horário, observação, participantes e lembretes, com concluir/editar/excluir.
 */
export function EventDetails({
  event,
  timeZone,
  people,
  teams,
  ownerName,
  past,
}: {
  event: AgendaEvent;
  timeZone: string;
  people: Person[];
  teams: AgendaTeam[];
  ownerName: string | null;
  /** o horário já passou */
  past: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const close = () => {
    const p = new URLSearchParams(search.toString());
    p.delete('evento');
    // veio da notificação (só ?evento=): continua no dia do compromisso
    if (!p.has('data') && !p.has('vista')) {
      p.set('vista', 'dia');
      p.set('data', zonedParts(event.starts_at, timeZone).date);
    }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  const when = new Date(event.starts_at);
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(when);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(when);
  const names = (event.people ?? []).map((id) => people.find((p) => p.id === id)?.name ?? 'usuário');
  const row = 'flex items-start gap-3 text-sm';
  const icon = 'mt-0.5 h-4 w-4 shrink-0 text-ink-2';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Detalhes do compromisso">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-series-1">
              <CalendarClock className="h-3.5 w-3.5" /> Compromisso
              {event.done_at ? (
                <span className="rounded-full bg-good/15 px-2 py-0.5 text-[11px] text-good-ink">concluído</span>
              ) : (
                past && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">já passou</span>
              )}
            </p>
            <h2 className={`mt-1 text-lg font-semibold break-words ${event.done_at ? 'line-through opacity-70' : ''}`}>{event.title}</h2>
          </div>
          <button type="button" onClick={close} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div className={row}>
            <Clock className={icon} />
            <p>
              <span className="first-letter:uppercase">{day}</span>
              <br />
              <strong>{event.all_day ? 'Dia todo' : `às ${time}`}</strong>
            </p>
          </div>
          {event.notes && (
            <div className={row}>
              <StickyNote className={icon} />
              <p className="whitespace-pre-wrap break-words">{event.notes}</p>
            </div>
          )}
          <div className={row}>
            <Users className={icon} />
            <p>{names.length ? names.join(', ') : 'Só na agenda de quem criou'}</p>
          </div>
          <div className={row}>
            <Bell className={icon} />
            <p>
              {event.reminders?.length ? event.reminders.map((m) => reminderLabel(m, event.all_day)).join(' · ') : 'Sem lembrete'}
            </p>
          </div>
          {ownerName && (
            <div className={row}>
              <UserRound className={icon} />
              <p className="text-ink-2">Criado por {ownerName}</p>
            </div>
          )}
        </div>
        <div className="border-t border-line pt-3">
          <EventActions event={event} timeZone={timeZone} people={people} teams={teams} labels />
        </div>
      </div>
    </div>
  );
}
