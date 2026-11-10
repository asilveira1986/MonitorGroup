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
