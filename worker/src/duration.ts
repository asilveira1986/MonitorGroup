/** Tempo de espera para os textos do worker: "14 min" ou "1h05". Negativo (relógio adiantado) vira "0 min". */
export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** O mesmo, a partir de segundos. */
export const formatWaitSeconds = (seconds: number): string => formatWait(seconds / 60);
