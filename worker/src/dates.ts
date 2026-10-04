/**
 * Reconhece prazos escritos em português nas mensagens da equipe, ex.:
 * "até hoje", "até amanhã", "até sexta", "até 15/10 às 14h", "em 2 dias", "em 3 horas".
 * Sem horário explícito, o prazo vale até o fim do expediente daquele dia.
 */

type Parts = { y: number; m: number; d: number; dow: number };

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function localParts(date: Date, timeZone: string): Parts {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Data/hora local (no fuso informado) convertida para um Date em UTC. */
export function localToDate(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  result = guess - offsetMinutes(new Date(result), timeZone) * 60_000; // ajuste em mudança de horário
  return new Date(result);
}

function addDays(p: Parts, days: number): Parts {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

export function parsePromise(
  text: string | null | undefined,
  now: Date,
  opts: { timeZone: string; businessEnd: string },
): Date | null {
  if (!text) return null;
  const t = normalize(text);
  const today = localParts(now, opts.timeZone);
  const [endH, endM] = opts.businessEnd.split(':').map(Number);

  // horário explícito: "às 14h", "as 14:30", "14h"
  const timeMatch = /\b(?:as|a)?\s*(\d{1,2})(?::(\d{2})|h(\d{2})?)\b/.exec(t.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' '));
  const hasTime = Boolean(timeMatch && /(:|h)/.test(timeMatch[0]));
  const hh = hasTime ? Math.min(23, Number(timeMatch![1])) : endH;
  const mm = hasTime ? Number(timeMatch![2] ?? timeMatch![3] ?? 0) : endM || 0;
  const at = (p: Parts) => localToDate(p.y, p.m, p.d, hh, mm, opts.timeZone);

  // relativos em minutos/horas/dias
  const rel = /\bem (\d{1,3}) ?(minutos?|min|horas?|h|dias? uteis|dias?)\b/.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2].startsWith('min')) return new Date(now.getTime() + n * 60_000);
    if (rel[2].startsWith('h')) return new Date(now.getTime() + n * 3_600_000);
    let target = today;
    if (rel[2].includes('uteis')) {
      let left = n;
      while (left > 0) {
        target = addDays(target, 1);
        if (target.dow !== 0 && target.dow !== 6) left--;
      }
    } else {
      target = addDays(today, n);
    }
    return at(target);
  }

  // tudo abaixo exige "até" (evita confundir com datas citadas por outros motivos)
  if (!/\bate\b/.test(t) && !/\bprazo\b/.test(t)) return null;

  if (/\b(ate|prazo:?)\s+(o\s+)?(fim do dia|hoje)\b/.test(t)) return at(today);
  if (/\b(ate|prazo:?)\s+depois de amanha\b/.test(t)) return at(addDays(today, 2));
  if (/\b(ate|prazo:?)\s+amanha\b/.test(t)) return at(addDays(today, 1));

  const wd = /\b(?:ate|prazo:?)\s+(?:a |o |na |no )?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira| feira)?\b/.exec(t);
  if (wd) {
    const ahead = (WEEKDAYS[wd[1]] - today.dow + 7) % 7;
    return at(addDays(today, ahead));
  }

  const dm = /\b(?:ate|prazo:?)\s+(?:o dia |dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : today.y;
    const candidate = { y, m, d, dow: 0 };
    if (!dm[3] && (m < today.m || (m === today.m && d < today.d))) y += 1; // data já passou: ano que vem
    return at({ ...candidate, y });
  }

  return null;
}
