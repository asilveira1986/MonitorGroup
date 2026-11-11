/**
 * Conversas privadas finalizadas: a página já traz as dos últimos 90 dias (padrão); períodos maiores
 * são buscados ao escolher na tela. Sem dependências, para a página (servidor) e a tela usarem o mesmo código.
 */
export const CLOSED_DEFAULT_DAYS = 90;
export const CLOSED_MAX = 1000;
export const CLOSED_PERIODS = [
  { days: 7, label: 'Últimos 7 dias' },
  { days: 30, label: 'Últimos 30 dias' },
  { days: 90, label: 'Últimos 90 dias (padrão)' },
  { days: 180, label: 'Últimos 180 dias' },
  { days: 365, label: 'Último ano' },
  { days: 0, label: 'Todo o período' },
];

/** começo do período (ISO); 0 = sem limite */
export function closedSince(days: number, now: number = Date.now()): string {
  return days > 0 ? new Date(now - days * 86_400_000).toISOString() : '';
}
