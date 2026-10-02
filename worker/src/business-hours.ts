/**
 * Verifica se um instante está dentro do horário comercial configurado,
 * considerando o fuso horário da empresa.
 */
export function isWithinBusinessHours(
  date: Date,
  opts: { timezone: string; businessDays: number[]; start: string; end: string },
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: opts.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));

  if (!opts.businessDays.includes(weekday)) return false;
  const start = toMinutes(opts.start);
  const end = toMinutes(opts.end);
  if (start <= end) return minutes >= start && minutes < end;
  // horário que atravessa a meia-noite (ex.: 22:00 - 06:00)
  return minutes >= start || minutes < end;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}
