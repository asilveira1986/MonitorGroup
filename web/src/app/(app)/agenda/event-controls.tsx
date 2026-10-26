'use client';

import { Check, Pencil, Plus, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, Textarea, Toggle } from '@/components/ui';
import { createAgendaEvent, deleteAgendaEvent, setAgendaEventDone, updateAgendaEvent } from './actions';

export type AgendaEvent = {
  id: string;
  member_id: string | null;
  owner_id?: string | null;
  /** participantes (usuários, 0097) */
  people?: string[];
  title: string;
  notes: string | null;
  starts_at: string;
  all_day: boolean;
  done_at: string | null;
};

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
    const values = { people: who, title, notes, startsAt, allDay };
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
      <form onSubmit={submit} className="relative w-full max-w-md space-y-4 rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
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
        <Toggle checked={allDay} onChange={setAllDay} label="Dia todo (sem horário)" />
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
}: {
  event: AgendaEvent;
  timeZone: string;
  people: Person[];
  teams: AgendaTeam[];
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
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={pending}
        className={`${btn} text-critical-ink`}
        aria-label="Excluir compromisso"
        onClick={() => confirm(`Excluir o compromisso "${event.title}"?`) && run(() => deleteAgendaEvent(event.id), 'Compromisso excluído')}
      >
        <Trash2 className="h-3.5 w-3.5" />
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
