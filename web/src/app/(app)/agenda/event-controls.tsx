'use client';

import { Bell, Briefcase, CalendarClock, CalendarDays, Check, Clock, Lock, Pencil, Plus, Repeat, RotateCcw, Search, StickyNote, Tag, Trash2, UserRound, Users, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { AGENDA_COLORS, agendaColor, type AgendaType } from '@/lib/agenda-colors';
import { createAgendaEvent, deleteAgendaEvent, setAgendaEventDone, updateAgendaEvent, type RepeatRule } from './actions';
import { NATURE_REQUIRED, natureLabel, type EventNature } from '@/lib/agenda-nature';
import { addDaysYmd, diffDays, durationLabel, endAfterStart, endFor, eventMinutes, shiftEnd, spanLabel, whenLabel } from '@/lib/agenda-time';

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
  /** término (0172); vazio = só o início */
  ends_at?: string | null;
  all_day: boolean;
  done_at: string | null;
  /** lembretes: minutos antes (0101) */
  reminders?: number[];
  /** tipo e repetição (0102) */
  type_id?: string | null;
  series_id?: string | null;
  series?: RepeatRule | null;
  /** particular ou profissional (0168) */
  nature?: EventNature | null;
};

/** Selo "Particular" (o profissional é o padrão do dia a dia e não leva selo). */
export function NatureBadge({ nature, className = '' }: { nature?: EventNature | null; className?: string }) {
  if (nature !== 'personal') return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-series-1/12 px-1.5 py-px text-[9px] font-semibold text-ink-2 ${className}`} title="Compromisso particular">
      <Lock className="h-3 w-3" aria-hidden /> Particular
    </span>
  );
}

/** Seção do formulário: título pequeno com ícone e o conteúdo num cartão leve. */
function Section({ icon: Icon, title, hint, children, className = '' }: { icon: typeof Clock; title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`space-y-2 rounded-2xl border border-line bg-surface p-3 ${className}`}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {title}
        {hint && <span className="ml-auto text-[9px] font-normal normal-case tracking-normal text-muted">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Escolha obrigatória: particular ou profissional (0168). Sem marca nenhuma até a pessoa escolher. */
function NaturePicker({ value, onChange, invalid }: { value: EventNature | null; onChange: (v: EventNature) => void; invalid: boolean }) {
  const options: { key: EventNature; icon: typeof Clock; title: string; text: string }[] = [
    { key: 'professional', icon: Briefcase, title: 'Profissional', text: 'Trabalho e clientes' },
    { key: 'personal', icon: Lock, title: 'Particular', text: 'Assunto pessoal' },
  ];
  return (
    <div role="radiogroup" aria-label="Natureza do compromisso" aria-required="true" aria-invalid={invalid} className={`grid grid-cols-2 gap-2 rounded-2xl p-0.5 ${invalid ? 'ring-2 ring-critical/50' : ''}`}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
              on ? 'border-brand bg-brand-soft text-brand-text shadow-sm' : 'border-line bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
            }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`}>
              <o.icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{o.title}</span>
              <span className="block truncate text-[9px] font-normal opacity-80">{o.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
  const repeating = value.freq !== 'none' && Boolean(unit);
  return (
    // com a repetição ligada, o seletor e as opções ficam lado a lado (a seção tem duas colunas no computador)
    <div className="space-y-2 md:flex md:items-start md:gap-3 md:space-y-0">
      <Select
        value={value.freq}
        onChange={(e) => set({ freq: e.target.value as RepeatState['freq'] })}
        aria-label="Repetir"
        className={repeating ? 'md:w-48 md:shrink-0' : undefined}
      >
        <option value="none">Não repete</option>
        {FREQ.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
      {value.freq !== 'none' && unit && (
        <div className="space-y-1.5 rounded-xl border border-line p-2.5 md:min-w-0 md:flex-1">
          {/* "A cada" e "Termina" lado a lado (quebra se faltar espaço) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2">Termina</span>
            <Select value={value.end} onChange={(e) => set({ end: e.target.value as RepeatState['end'] })} className="h-9 w-auto" aria-label="Termina">
              <option value="never">Nunca</option>
              <option value="until">Em uma data</option>
              <option value="count">{value.freq === 'daily' && value.every === 1 ? 'Por' : 'Depois de'}</option>
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
                {/* "Por 5 dias", "Por 3 semanas"...: a repetição diária por X dias */}
                <span className="text-ink-2">{value.every === 1 && unit ? unit[1] : 'vezes'}</span>
              </>
            )}
          </div>
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
      {!value.length && <span className="text-[9px] text-muted">Sem lembrete</span>}
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

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

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
      {/* setores, busca, "todos" e "ninguém" numa linha só (quebra no celular) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {teams.map((t) => {
          const all = t.userIds.length > 0 && t.userIds.every((id) => has.has(id));
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(all ? value.filter((id) => !t.userIds.includes(id)) : [...new Set([...value, ...t.userIds])])}
              aria-pressed={all}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${all ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:border-brand-line'}`}
              title={all ? 'Tirar todos deste setor' : 'Marcar todos deste setor'}
            >
              <Users className="h-3 w-3" /> {t.name} <span className="text-muted">({t.userIds.length})</span>
            </button>
          );
        })}
        <span className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
          {people.length > 6 && (
            <span className="relative min-w-0 flex-1 sm:w-48 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa" className="h-8 pl-8 text-xs sm:h-8 sm:text-xs" />
            </span>
          )}
          <button type="button" onClick={() => onChange(people.map((p) => p.id))} className="rounded-full px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft">
            todos
          </button>
          <button type="button" onClick={() => onChange([])} className="rounded-full px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">
            ninguém
          </button>
        </span>
      </div>
      <ul className="grid max-h-32 content-start gap-1 overflow-y-auto sm:grid-cols-2 lg:max-h-[6.75rem] lg:grid-cols-4">
        {shown.map((p) => {
          const on = has.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((id) => id !== p.id) : [...value, p.id])}
                className={`flex w-full items-center gap-2 rounded-xl border px-2 py-1 text-left text-sm transition ${on ? 'border-brand-line bg-brand-soft/60' : 'border-transparent hover:bg-surface-2'}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2'}`}>{on ? <Check className="h-3.5 w-3.5" aria-hidden /> : initialsOf(p.name)}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-2 py-1.5 text-xs text-muted">Ninguém encontrado.</li>}
      </ul>
      {!value.length && <p className="text-[9px] text-muted">Ninguém marcado: fica só na sua agenda.</p>}
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
  // término (0172/0175): dia e hora; compromisso de vários dias termina em outro dia. Sem término: dia igual ao do início e hora vazia
  const initialEnd = event?.ends_at ? zonedParts(event.ends_at, timeZone) : null;
  const [endDate, setEndDate] = useState(initialEnd?.date ?? initial.date);
  const [endTime, setEndTime] = useState(event?.all_day || !initialEnd ? '' : initialEnd.time);
  const [endError, setEndError] = useState<string | null>(null);
  const changeStart = (next: string) => {
    // término no mesmo dia: acompanha o início, mantendo a duração
    if (endDate === date) setEndTime((end) => shiftEnd(time, next, end));
    setTime(next);
    setEndError(null);
  };
  /** mudou o dia do início: o término anda junto, mantendo quantos dias o compromisso dura */
  const changeDate = (next: string) => {
    if (next && endDate >= date) setEndDate(addDaysYmd(next, diffDays(date, endDate)));
    else if (next) setEndDate(next);
    setDate(next);
    setEndError(null);
  };
  const pickEndDate = (next: string) => {
    setEndDate(next || date);
    // outro dia sem hora de término: começa com a mesma hora do início
    if (next && next > date && !allDay && !endTime) setEndTime(time);
    setEndError(null);
  };
  const addDays = (n: number) => pickEndDate(addDaysYmd(date, n));
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [who, setWho] = useState<string[]>(event?.people?.length ? event.people : defaultPeople);
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? [15]);
  // dia todo: o padrão passa a ser "no dia, às 8h" (se ainda estava no padrão)
  const changeAllDay = (on: boolean) => {
    setAllDay(on);
    if (!event && reminders.length === 1 && reminders[0] === (on ? 15 : 0)) setReminders([on ? 0 : 15]);
  };
  const [typeId, setTypeId] = useState<string | null>(event?.type_id ?? null);
  // particular ou profissional: obrigatório, sem marca até a pessoa escolher (0168)
  const [nature, setNature] = useState<EventNature | null>(event?.nature ?? null);
  const [natureError, setNatureError] = useState(false);
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
    if (!nature) {
      setNatureError(true);
      document.getElementById('agenda-nature')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return void toast.error(NATURE_REQUIRED);
    }
    if (!title.trim()) return void toast.error('Informe o título do compromisso.');
    if (!date) return void toast.error('Informe a data do compromisso.');
    const multi = endDate > date;
    const effEnd = allDay ? '12:00' : endTime || (multi ? time || '09:00' : '');
    if (!endAfterStart(date, allDay ? '12:00' : time || '09:00', endDate, effEnd)) {
      setEndError('O término deve ser depois do início.');
      return void toast.error('O término deve ser depois do início.');
    }
    if (diffDays(date, endDate) > 31) {
      setEndError('O compromisso pode durar até 31 dias. Para períodos maiores, use a repetição.');
      return void toast.error('O compromisso pode durar até 31 dias.');
    }
    // dia todo: meio-dia no fuso da empresa, para o dia não mudar com o fuso
    const startsAt = zonedIso(date, allDay ? '12:00' : time || '09:00', timeZone);
    const rule = toRule(repeat);
    if (rule?.until && rule.until < date) return void toast.error('A data final da repetição é antes do compromisso.');
    const values = {
      people: who,
      title,
      notes,
      startsAt,
      endsAt: allDay ? (multi ? zonedIso(endDate, '12:00', timeZone) : null) : effEnd ? zonedIso(endDate, effEnd, timeZone) : null,
      allDay,
      reminders,
      typeId,
      nature,
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <form onSubmit={submit} noValidate className="relative flex max-h-[97dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface-2 shadow-2xl sm:rounded-3xl lg:max-w-5xl">
        <div className="flex items-center justify-between gap-3 bg-surface px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-text">
              <CalendarDays className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold leading-tight">{event ? 'Editar compromisso' : 'Novo compromisso'}</h2>
              <p className="truncate text-xs text-ink-2">{personName ? `Na agenda de ${personName}` : 'Escolha o tipo, o dia e quem participa'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* celular: uma coluna, nesta ordem. Computador: duas colunas, com o "Quando" ocupando a largura toda */}
        <div className="grid flex-1 content-start gap-2.5 overflow-y-auto p-3 sm:p-3 lg:grid-cols-3">
            <div id="agenda-nature" className={`lg:col-start-2 lg:row-start-1 [&>section]:h-full ${types.length > 0 ? '' : 'lg:col-span-2'}`}>
              <Section icon={Lock} title="Este compromisso é" hint={<span className={natureError ? 'font-semibold text-critical-ink' : ''}>obrigatório</span>}>
                <NaturePicker
                  value={nature}
                  onChange={(v) => {
                    setNature(v);
                    setNatureError(false);
                  }}
                  invalid={natureError}
                />
                {natureError && <p className="text-xs font-medium text-critical-ink">{NATURE_REQUIRED}</p>}
                <p className="text-[9px] text-muted">Particular: quem não participa vê só “Ocupado”.</p>
              </Section>
            </div>
            <Section icon={StickyNote} title="O que é" className="lg:col-start-1 lg:row-start-1">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Reunião com o cliente, audiência..."
                maxLength={200}
                required
                autoFocus
                aria-label="Título"
                className="h-11 text-base font-medium"
              />
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Observação (opcional): local, link, detalhes..." aria-label="Observação" className="resize-none" />
            </Section>
            <Section
              icon={Clock}
              title="Quando"
              className="lg:col-span-3 lg:row-start-2"
              hint={(() => {
                const m = !allDay && endTime ? eventMinutes(zonedIso(date, time || '09:00', timeZone), zonedIso(endDate, endTime, timeZone), false) : null;
                const days = endDate > date ? diffDays(date, endDate) : 0;
                return allDay ? (days ? `${days + 1} dias` : undefined) : m ? spanLabel(m) : undefined;
              })()}
            >
              {/* início e término lado a lado (uma coluna no celular) */}
              <div className="grid gap-3 md:grid-cols-2 md:gap-5">
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-ink-2">Início</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        // semanal no dia padrão: acompanha o dia escolhido
                        if (e.target.value && repeat.weekdays.length === 1 && repeat.weekdays[0] === dowOf(date)) setRepeat({ ...repeat, weekdays: [dowOf(e.target.value)] });
                        changeDate(e.target.value);
                      }}
                      required
                      aria-label="Dia do início"
                    />
                    <Input type="time" value={time} onChange={(e) => changeStart(e.target.value)} disabled={allDay} aria-label="Hora do início" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className={`block text-xs font-medium ${endError ? 'text-critical-ink' : 'text-ink-2'}`}>Término</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
                    <Input
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => pickEndDate(e.target.value)}
                      aria-label="Dia do término"
                      aria-invalid={Boolean(endError)}
                      className={endError ? 'border-critical' : ''}
                    />
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                        setEndError(null);
                      }}
                      disabled={allDay}
                      aria-label="Hora do término (opcional)"
                      aria-invalid={Boolean(endError)}
                      className={endError ? 'border-critical' : ''}
                    />
                  </div>
                </div>
              </div>
              {endError && <p className="text-xs font-medium text-critical-ink">{endError}</p>}
              {/* atalhos e "dia todo" na mesma faixa */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2.5">
                {!allDay && (
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Duração">
                    <span className="text-[9px] text-muted">Duração:</span>
                    {[30, 60, 90, 120].map((m) => {
                      const target = endFor(time, m);
                      const on = Boolean(target) && endDate === date && endTime === target;
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={!target}
                          aria-pressed={on}
                          onClick={() => {
                            setEndDate(date);
                            setEndTime(target);
                            setEndError(null);
                          }}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-40 ${on ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:border-brand-line'}`}
                        >
                          {durationLabel(m)}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vários dias">
                  <span className="text-[9px] text-muted">Vários dias:</span>
                  {[1, 2, 6].map((n) => {
                    const on = diffDays(date, endDate) === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        onClick={() => addDays(n)}
                        title={`Termina ${n === 1 ? 'no dia seguinte' : `${n} dias depois`}`}
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${on ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:border-brand-line'}`}
                      >
                        {n === 6 ? 'até 1 semana' : `+${n} dia${n > 1 ? 's' : ''}`}
                      </button>
                    );
                  })}
                  {(endTime || endDate > date) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEndDate(date);
                        setEndTime('');
                        setEndError(null);
                      }}
                      className="rounded-full px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2"
                    >
                      sem término
                    </button>
                  )}
                </div>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={allDay} onChange={(e) => changeAllDay(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                  Dia todo
                </label>
              </div>
            </Section>
            {types.length > 0 && (
              <Section icon={Tag} title="Tipo" className="lg:col-start-3 lg:row-start-1">
                <TypePicker types={types} value={typeId} onChange={setTypeId} />
              </Section>
            )}
            <Section icon={Repeat} title="Repetir" className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
              <RepeatPicker value={repeat} onChange={setRepeat} />
            </Section>
            <Section icon={Bell} title="Lembretes" className="lg:col-start-3 lg:row-start-3">
              <RemindersPicker value={reminders} onChange={setReminders} allDay={allDay} />
            </Section>
            <Section icon={Users} title="Participantes" hint={who.length ? `${who.length} marcado(s)` : undefined} className="lg:col-span-3 lg:row-start-4">
              <PeoplePicker people={people} teams={teams} value={who} onChange={setWho} />
            </Section>
            {inSeries && (
              <div className="space-y-1.5 rounded-2xl border border-line bg-surface p-3.5 text-sm lg:col-span-3">
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
        <div className="flex flex-wrap items-center gap-2 bg-surface px-5 py-2.5">
          <Button disabled={pending}>{pending ? 'Salvando…' : event ? 'Salvar' : 'Registrar compromisso'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {nature && <span className="ml-auto text-xs text-ink-2">{natureLabel(nature)}</span>}
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
              <NatureBadge nature={event.nature} />
              {event.done_at ? (
                <span className="rounded-full bg-good/15 px-2 py-0.5 text-[9px] text-good-ink">concluído</span>
              ) : (
                past && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-ink-2">já passou</span>
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
              <strong>
                {event.all_day
                  ? whenLabel(event.starts_at, event.ends_at, true, timeZone).replace(/^dia todo/, 'Dia todo')
                  : event.ends_at
                    ? whenLabel(event.starts_at, event.ends_at, false, timeZone).replace('–', ' às ').replace(/^(\d)/, 'das $1').replace(' → ', ' até ')
                    : `às ${time}`}
              </strong>
              {eventMinutes(event.starts_at, event.ends_at, event.all_day) && <span className="text-ink-2"> · {spanLabel(eventMinutes(event.starts_at, event.ends_at, event.all_day)!)}</span>}
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
