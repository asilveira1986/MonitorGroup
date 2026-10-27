'use client';

import { Bell, CalendarClock, Check, Clock, Pencil, Plus, Repeat, RotateCcw, StickyNote, Tag, Trash2, UserRound, Users, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { AGENDA_COLORS, agendaColor, type AgendaType } from '@/lib/agenda-colors';
import { createAgendaEvent, deleteAgendaEvent, setAgendaEventDone, updateAgendaEvent, type RepeatRule } from './actions';

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
  /** tipo e repetição (0102) */
  type_id?: string | null;
  series_id?: string | null;
  series?: RepeatRule | null;
};

// ---------- tipo e repetição (0102)
const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const FREQ: { key: RepeatRule['freq']; label: string; unit: [string, string] }[] = [
  { key: 'daily', label: 'Todos os dias', unit: ['dia', 'dias'] },
  { key: 'weekly', label: 'Todas as semanas', unit: ['semana', 'semanas'] },
  { key: 'monthly', label: 'Todos os meses', unit: ['mês', 'meses'] },
  { key: 'yearly', label: 'Todos os anos', unit: ['ano', 'anos'] },
];
type RepeatState = { freq: RepeatRule['freq'] | 'none'; every: number; weekdays: number[]; end: 'never' | 'until' | 'count'; until: string; count: number };

const toState = (r: RepeatRule | null | undefined, dow: number): RepeatState =>
  r
    ? { freq: r.freq, every: r.every || 1, weekdays: r.weekdays?.length ? r.weekdays : [dow], end: r.until ? 'until' : r.count ? 'count' : 'never', until: r.until ?? '', count: r.count ?? 10 }
    : { freq: 'none', every: 1, weekdays: [dow], end: 'never', until: '', count: 10 };
const toRule = (v: RepeatState): RepeatRule | null =>
  v.freq === 'none'
    ? null
    : {
        freq: v.freq,
        every: Math.max(1, Math.min(99, v.every || 1)),
        weekdays: v.freq === 'weekly' ? [...v.weekdays].sort() : [],
        until: v.end === 'until' && v.until ? v.until : null,
        count: v.end === 'count' ? Math.max(2, Math.min(500, v.count || 2)) : null,
      };
const sameRule = (a: RepeatRule | null, b: RepeatRule | null) => JSON.stringify(a) === JSON.stringify(b);

/** "Toda semana (seg, qua) · 10 vezes" */
export function repeatLabel(r: RepeatRule | null | undefined) {
  if (!r) return null;
  const f = FREQ.find((x) => x.key === r.freq);
  if (!f) return null;
  let text = r.every > 1 ? `A cada ${r.every} ${f.unit[1]}` : f.label;
  if (r.freq === 'weekly' && r.weekdays.length) text += ` (${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')})`;
  if (r.until) text += ` · até ${r.until.slice(8, 10)}/${r.until.slice(5, 7)}/${r.until.slice(0, 4)}`;
  else if (r.count) text += ` · ${r.count} vezes`;
  return text;
}

function TypePicker({ types, value, onChange }: { types: AgendaType[]; value: string | null; onChange: (v: string | null) => void }) {
  const chip = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition';
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo do compromisso">
      <button type="button" role="radio" aria-checked={!value} onClick={() => onChange(null)} className={`${chip} ${!value ? 'border-ink text-ink' : 'border-line text-ink-2 hover:border-ink-2'}`}>
        Sem tipo
      </button>
      {types.map((t) => {
        const on = value === t.id;
        const hex = AGENDA_COLORS[t.color]?.hex;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t.id)}
            className={`${chip} ${on ? 'text-ink' : 'border-line text-ink-2 hover:text-ink'}`}
            style={on ? { borderColor: hex, backgroundColor: `${hex}22` } : undefined}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hex }} aria-hidden /> {t.name}
          </button>
        );
      })}
    </div>
  );
}

function RepeatPicker({ value, onChange }: { value: RepeatState; onChange: (v: RepeatState) => void }) {
  const set = (p: Partial<RepeatState>) => onChange({ ...value, ...p });
  const unit = FREQ.find((f) => f.key === value.freq)?.unit;
  return (
    <div className="space-y-2">
      <Select value={value.freq} onChange={(e) => set({ freq: e.target.value as RepeatState['freq'] })} aria-label="Repetir">
        <option value="none">Não repete</option>
        {FREQ.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
      {value.freq !== 'none' && unit && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-2">A cada</span>
            <Input
              type="number"
              min={1}
              max={99}
              value={value.every}
              onChange={(e) => set({ every: Number(e.target.value) || 1 })}
              className="h-9 w-16 text-center"
              aria-label="Intervalo"
            />
            <span className="text-ink-2">{value.every > 1 ? unit[1] : unit[0]}</span>
          </div>
          {value.freq === 'weekly' && (
            <div className="flex gap-1" role="group" aria-label="Dias da semana">
              {WEEKDAY_SHORT.map((d, i) => {
                const on = value.weekdays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_NAMES[i]}
                    onClick={() => {
                      const next = on ? value.weekdays.filter((x) => x !== i) : [...value.weekdays, i];
                      if (next.length) set({ weekdays: next });
                    }}
                    className={`h-8 w-8 rounded-full text-xs font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2">Termina</span>
            <Select value={value.end} onChange={(e) => set({ end: e.target.value as RepeatState['end'] })} className="h-9 w-auto" aria-label="Termina">
              <option value="never">Nunca</option>
              <option value="until">Em uma data</option>
              <option value="count">Depois de</option>
            </Select>
            {value.end === 'until' && <Input type="date" value={value.until} onChange={(e) => set({ until: e.target.value })} className="h-9 w-auto" required />}
            {value.end === 'count' && (
              <>
                <Input
                  type="number"
                  min={2}
                  max={500}
                  value={value.count}
                  onChange={(e) => set({ count: Number(e.target.value) || 2 })}
                  className="h-9 w-20 text-center"
                  aria-label="Quantas vezes"
                />
                <span className="text-ink-2">vezes</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((m) => (
        <span key={m} className="inline-flex h-7 items-center gap-1 rounded-full bg-series-1/12 pl-2 pr-1 text-xs font-medium text-ink">
          <Bell className="h-3 w-3 text-series-1" aria-hidden />
          {reminderLabel(m, allDay)}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== m))}
            className="rounded-full p-0.5 text-ink-2 hover:bg-surface-2 hover:text-critical-ink"
            aria-label={`Tirar o lembrete ${reminderLabel(m, allDay)}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {value.length < MAX_REMINDERS && free.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value !== '' && onChange([...value, Number(e.target.value)].sort((x, y) => x - y))}
          aria-label="Adicionar lembrete"
          className="h-7 rounded-full border border-dashed border-line bg-surface px-2 text-xs text-ink-2 outline-none hover:border-brand-line focus:border-brand-line"
        >
          <option value="">+ lembrete</option>
          {free.map((o) => (
            <option key={o} value={o}>
              {reminderLabel(o, allDay)}
            </option>
          ))}
        </select>
      )}
      {!value.length && <span className="text-[11px] text-muted">Sem lembrete</span>}
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
      <div className="max-h-36 overflow-y-auto rounded-xl border border-line p-1">
        {shown.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
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
  types,
  onClose,
}: {
  defaultPeople: string[];
  people: Person[];
  teams: AgendaTeam[];
  personName: string | null;
  timeZone: string;
  defaultDate: string;
  event?: AgendaEvent;
  types: AgendaType[];
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
  const [typeId, setTypeId] = useState<string | null>(event?.type_id ?? null);
  const dowOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const initialRule = event ? (event.series ?? null) : null;
  const [repeat, setRepeat] = useState<RepeatState>(toState(initialRule, dowOf(initial.date)));
  const [scope, setScope] = useState<'one' | 'following'>('one');
  const inSeries = Boolean(event?.series_id);
  const ruleChanged = !sameRule(toRule(repeat), initialRule);
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
    const rule = toRule(repeat);
    if (rule?.until && rule.until < date) return void toast.error('A data final da repetição é antes do compromisso.');
    const values = {
      people: who,
      title,
      notes,
      startsAt,
      allDay,
      reminders,
      typeId,
      // novo: a regra (ou nada); edição: só se mudou ({ freq: 'none' } = deixa de repetir)
      repeat: event ? (ruleChanged ? (rule ?? { freq: 'none' as const }) : null) : rule,
      scope: inSeries && (ruleChanged || scope === 'following') ? ('following' as const) : ('one' as const),
    };
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
      <form onSubmit={submit} className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl lg:max-w-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">
            {event ? 'Editar compromisso' : 'Novo compromisso'}
            {personName && <span className="ml-2 text-xs font-normal text-ink-2">na agenda de {personName}</span>}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* computador: duas colunas (o quê e quando | repetição, lembretes e quem) */}
        <div className="grid flex-1 gap-x-5 gap-y-3 overflow-y-auto px-4 py-3 lg:grid-cols-2">
          <div className="space-y-3">
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
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <Field label="Dia">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    // semanal no dia padrão: acompanha o dia escolhido
                    if (e.target.value && repeat.weekdays.length === 1 && repeat.weekdays[0] === dowOf(date)) setRepeat({ ...repeat, weekdays: [dowOf(e.target.value)] });
                    setDate(e.target.value);
                  }}
                  required
                />
              </Field>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink-2">Hora</span>
                  <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-ink-2">
                    <input type="checkbox" checked={allDay} onChange={(e) => changeAllDay(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                    dia todo
                  </label>
                </div>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={allDay} className="w-36 sm:w-32" aria-label="Hora" />
              </div>
          </div>
            {types.length > 0 && (
              <Field label="Tipo">
                <TypePicker types={types} value={typeId} onChange={setTypeId} />
              </Field>
            )}
            <Field label="Observação (opcional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Local, link, detalhes..." />
            </Field>
          </div>
          <div className="space-y-3">
            <Field label="Repetir">
              <RepeatPicker value={repeat} onChange={setRepeat} />
            </Field>
            <Field label="Lembretes">
              <RemindersPicker value={reminders} onChange={setReminders} allDay={allDay} />
            </Field>
            <Field label="Participantes">
              <PeoplePicker people={people} teams={teams} value={who} onChange={setWho} />
            </Field>
            {inSeries && (
              <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
                <p className="text-xs font-medium text-ink-2">Este compromisso se repete. Salvar em:</p>
                {ruleChanged ? (
                  <p className="text-xs text-ink-2">A repetição mudou: vale para <b>este e os próximos</b>.</p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {(
                      [
                        ['one', 'Só este'],
                        ['following', 'Este e os próximos'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="inline-flex cursor-pointer items-center gap-2">
                        <input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} className="accent-[var(--brand)]" />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
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
  types: AgendaType[];
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
  types,
  labels = false,
}: {
  event: AgendaEvent;
  timeZone: string;
  people: Person[];
  teams: AgendaTeam[];
  types: AgendaType[];
  /** com o nome em cada botão (detalhes do compromisso) */
  labels?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
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
        onClick={() =>
          event.series_id
            ? setAskDelete(true)
            : confirm(`Excluir o compromisso "${event.title}"?`) && run(() => deleteAgendaEvent(event.id), 'Compromisso excluído')
        }
      >
        <Trash2 className="h-3.5 w-3.5" /> {labels && 'Excluir'}
      </button>
      {askDelete && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Excluir compromisso que se repete">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAskDelete(false)} />
          <div className="relative w-full max-w-sm space-y-3 rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
            <h2 className="text-base font-semibold">Excluir “{event.title}”</h2>
            <p className="text-sm text-ink-2">Este compromisso se repete. O que excluir?</p>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" disabled={pending} onClick={() => (setAskDelete(false), run(() => deleteAgendaEvent(event.id, 'one'), 'Compromisso excluído'))}>
                Só este
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => (setAskDelete(false), run(() => deleteAgendaEvent(event.id, 'following'), 'Este e os próximos excluídos'))}>
                Este e os próximos
              </Button>
              <Button variant="ghost" onClick={() => setAskDelete(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <EventDialog
          defaultPeople={event.people ?? []}
          people={people}
          teams={teams}
          personName={null}
          timeZone={timeZone}
          defaultDate={zonedParts(event.starts_at, timeZone).date}
          event={event}
          types={types}
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
  types,
}: {
  event: AgendaEvent;
  timeZone: string;
  people: Person[];
  teams: AgendaTeam[];
  types: AgendaType[];
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
  const type = types.find((t) => t.id === event.type_id);
  const color = agendaColor(type?.color);
  const repeats = repeatLabel(event.series);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Detalhes do compromisso">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        className="relative max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl border-t-4 bg-surface p-5 shadow-2xl sm:rounded-2xl"
        style={{ borderTopColor: color }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium" style={{ color }}>
              {type ? <Tag className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />} {type?.name ?? 'Compromisso'}
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
          {repeats && (
            <div className={row}>
              <Repeat className={icon} />
              <p>{repeats}</p>
            </div>
          )}
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
          <EventActions event={event} timeZone={timeZone} people={people} teams={teams} types={types} labels />
        </div>
      </div>
    </div>
  );
}
