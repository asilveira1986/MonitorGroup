/**
 * Recuperar mensagens antigas (0161, experimental): períodos oferecidos e textos do andamento.
 * Sem dependências, para o painel e os testes usarem o mesmo código.
 */

export const DAY_OPTIONS = [1, 3, 7, 15, 30] as const;
export const DEFAULT_DAYS = 7;

export type RecoveryStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** Pedido ainda em andamento (na fila ou rodando)? */
export const isOpen = (status: string): boolean => status === 'pending' || status === 'running';

export const STATUS_LABEL: Record<RecoveryStatus, string> = {
  pending: 'Na fila (esperando o worker)',
  running: 'Recuperando…',
  done: 'Concluído',
  failed: 'Não deu certo',
  cancelled: 'Cancelado',
};

/** O período pedido é um dos oferecidos (1 a 30 dias)? */
export function validDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30;
}

/** "3 mensagens novas · 120 vistas · 4 pedidos" */
export function summary(r: { added: number; found: number; requests: number }): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [plural(r.added, 'mensagem nova', 'mensagens novas'), plural(r.found, 'vista', 'vistas'), plural(r.requests, 'pedido', 'pedidos')].join(' · ');
}
