/** Alerta de agenda em tela (0170): um lembrete que tocou, e como mostrar e falar. */
export type AgendaReminder = {
  event_id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  /** minutos antes do horário (0 = na hora) */
  minutes: number;
  fire_at: string;
  nature?: 'professional' | 'personal' | null;
  /** "em 15 min", "agora", "amanhã"... (do banco) */
  label: string;
};

/** Chave do lembrete (evento, horário e minutos): a tela mostra uma vez só neste navegador. */
export const reminderKey = (r: Pick<AgendaReminder, 'event_id' | 'starts_at' | 'minutes'>) => `agenda-alert:${r.event_id}:${r.starts_at}:${r.minutes}`;

/** Lembretes ainda não mostrados (e sem repetir o mesmo na lista). */
export function unseenReminders(rows: AgendaReminder[], seen: (key: string) => boolean): AgendaReminder[] {
  const out: AgendaReminder[] = [];
  const keys = new Set<string>();
  for (const r of rows) {
    const k = reminderKey(r);
    if (keys.has(k) || seen(k)) continue;
    keys.add(k);
    out.push(r);
  }
  return out;
}

/** "14:30" no fuso da empresa, ou "dia todo". */
export function reminderWhen(r: Pick<AgendaReminder, 'starts_at' | 'all_day'>, timeZone: string): string {
  if (r.all_day) return 'Dia todo';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(r.starts_at));
}

/** Na hora (0 min) é crítico; antes, atenção. */
export const reminderTone = (r: Pick<AgendaReminder, 'minutes' | 'all_day'>): 'critical' | 'warning' => (r.minutes === 0 && !r.all_day ? 'critical' : 'warning');

/** Frase falada: "Compromisso em 15 min: Reunião com o cliente." */
export function reminderSpeech(r: Pick<AgendaReminder, 'label' | 'title'>): string {
  const title = r.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Compromisso ${r.label}: ${title}.`;
}

/**
 * Quando é o compromisso novo, para o aviso: "hoje às 14:30", "amanhã às 09:00", "12/11 às 09:00" ou "12/11 · dia todo".
 * `now` e `timeZone` só existem para o teste; no navegador, o relógio e o fuso do aparelho.
 */
export function newEventWhen(startsAt: string, allDay: boolean, timeZone: string, now = Date.now()): string {
  const ymd = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const day = ymd(new Date(startsAt).getTime());
  const dayLabel = day === ymd(now) ? 'hoje' : day === ymd(now + 86_400_000) ? 'amanhã' : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  if (allDay) return `${dayLabel} · dia todo`;
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(startsAt));
  return `${dayLabel} às ${time}`;
}

/** Frase falada do compromisso novo. */
export function newEventSpeech(title: string, when: string, by: string | null): string {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${by ? `${by} marcou` : 'Novo compromisso na sua agenda'}${by ? ' um compromisso para você' : ''}: ${t}, ${when.replace(/\s*·\s*/, ', ')}.`;
}
