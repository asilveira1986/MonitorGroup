/** Horário de início e término do compromisso (0172): textos e contas simples com "HH:MM". */

/** "HH:MM" -> minutos desde 00:00 (null se inválido). */
export function toMinutes(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** minutos -> "HH:MM" (limitado ao mesmo dia: até 23:59). */
export function fromMinutes(total: number): string {
  const t = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** O término é depois do início? (sem término também vale) */
export const endIsAfterStart = (start: string, end: string): boolean => {
  if (!end) return true;
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s !== null && e !== null && e > s;
};

/** Mudou o início: o término anda junto, mantendo a duração (até 23:59). Sem término, continua sem. */
export function shiftEnd(oldStart: string, newStart: string, end: string): string {
  const os = toMinutes(oldStart);
  const ns = toMinutes(newStart);
  const e = toMinutes(end);
  if (!end || os === null || ns === null || e === null) return end;
  return fromMinutes(Math.max(ns + 1, e + (ns - os)));
}

/** Término para uma duração escolhida (ex.: 60 = "1 h"): início + minutos, ou '' se passa da meia-noite. */
export function endFor(start: string, minutes: number): string {
  const s = toMinutes(start);
  if (s === null || s + minutes > 23 * 60 + 59) return '';
  return fromMinutes(s + minutes);
}

/** Duração entre dois horários do mesmo dia, em minutos (null se não houver término válido). */
export function durationMinutes(start: string, end: string): number | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s !== null && e !== null && e > s ? e - s : null;
}

/** "45 min", "1 h", "1 h 30 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const hhmm = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** "14:00–15:30"; sem término, só "14:00"; dia todo, "dia todo". */
export function rangeLabel(startsAt: string, endsAt: string | null | undefined, allDay: boolean, timeZone: string): string {
  if (allDay) return 'dia todo';
  const start = hhmm(startsAt, timeZone);
  return endsAt ? `${start}–${hhmm(endsAt, timeZone)}` : start;
}

/** Duração do compromisso em minutos (null sem término ou dia todo). */
export function eventMinutes(startsAt: string, endsAt: string | null | undefined, allDay: boolean): number | null {
  if (allDay || !endsAt) return null;
  const m = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  return m > 0 ? m : null;
}
