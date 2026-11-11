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

// ---------- vários dias (0175)

const ymdParts = (ymd: string) => ymd.split('-').map(Number) as [number, number, number];

/** "2026-11-10" + n dias. */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dias entre duas datas "AAAA-MM-DD" (b - a). */
export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = ymdParts(a);
  const [yb, mb, db] = ymdParts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Todas as datas de a até b, inclusive (até 62, por segurança). */
export function ymdRange(a: string, b: string): string[] {
  const n = Math.min(62, Math.max(0, diffDays(a, b)));
  return Array.from({ length: n + 1 }, (_, i) => addDaysYmd(a, i));
}

/** Dia (AAAA-MM-DD) de um instante no fuso. */
export function dayOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** O compromisso termina em outro dia? (sem término: não) */
export function isMultiDay(startsAt: string, endsAt: string | null | undefined, timeZone: string): boolean {
  return Boolean(endsAt) && dayOf(endsAt!, timeZone) > dayOf(startsAt, timeZone);
}

/**
 * Em que dias aparece, do início ao término. Um término exatamente à meia-noite não conta o dia seguinte (o compromisso
 * "das 22:00 às 00:00" é só de um dia).
 */
export function eventDays(startsAt: string, endsAt: string | null | undefined, timeZone: string): string[] {
  const first = dayOf(startsAt, timeZone);
  if (!endsAt) return [first];
  let last = dayOf(endsAt, timeZone);
  const midnight = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(endsAt)) === '00:00';
  if (midnight && last > first) last = addDaysYmd(last, -1);
  return ymdRange(first, last < first ? first : last);
}

/** Duração para mostrar: "45 min", "1 h 30 min", "1 dia", "2 dias 3 h". */
export function spanLabel(minutes: number): string {
  if (minutes < 1440) return durationLabel(minutes);
  const d = Math.floor(minutes / 1440);
  const rest = minutes % 1440;
  const days = `${d} ${d === 1 ? 'dia' : 'dias'}`;
  return rest ? `${days} ${durationLabel(rest)}` : days;
}

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/**
 * Quando é, para a lista: "14:00–15:30" (mesmo dia), "22:00 → 13/11 09:30" (vários dias), "dia todo" ou
 * "dia todo · 12/11 a 15/11".
 */
export function whenLabel(startsAt: string, endsAt: string | null | undefined, allDay: boolean, timeZone: string): string {
  if (allDay) return isMultiDay(startsAt, endsAt, timeZone) ? `dia todo · ${ddmm(dayOf(startsAt, timeZone))} a ${ddmm(dayOf(endsAt!, timeZone))}` : 'dia todo';
  if (isMultiDay(startsAt, endsAt, timeZone)) {
    return `${hhmm(startsAt, timeZone)} → ${ddmm(dayOf(endsAt!, timeZone))} ${hhmm(endsAt!, timeZone)}`;
  }
  return rangeLabel(startsAt, endsAt, false, timeZone);
}

/** O término é depois do início? Datas e horas em campos separados. */
export function endAfterStart(startDate: string, startTime: string, endDate: string, endTime: string): boolean {
  if (!endDate) return true;
  if (endDate > startDate) return true;
  if (endDate < startDate) return false;
  return endIsAfterStart(startTime, endTime);
}
