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

/** Andamento do pedido em lote (todos os grupos), como vem do banco (0161). */
export type BatchStatus = {
  batchId: string;
  days: number;
  createdAt: string;
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  added: number;
  found: number;
  groupsWithNews: number;
  failedNotes: { note: string | null; n: number }[];
};

/** Ainda há grupos na fila ou sendo recuperados? */
export const batchOpen = (b: Pick<BatchStatus, 'pending' | 'running'>): boolean => b.pending + b.running > 0;

/** Quantos grupos já terminaram (concluídos, com falha ou cancelados) e o percentual do lote. */
export function batchProgress(b: Pick<BatchStatus, 'total' | 'pending' | 'running'>): { finished: number; percent: number } {
  const finished = Math.max(0, b.total - b.pending - b.running);
  return { finished, percent: b.total > 0 ? Math.round((finished / b.total) * 100) : 0 };
}

/** Linha do banco (jsonb da `history_recovery_batch_status`) -> BatchStatus; null se vier vazio. */
export function parseBatchStatus(raw: unknown): BatchStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  if (typeof r.batch_id !== 'string') return null;
  const notes = Array.isArray(r.failed_notes) ? (r.failed_notes as { note?: unknown; n?: unknown }[]) : [];
  return {
    batchId: r.batch_id,
    days: n(r.days),
    createdAt: String(r.created_at ?? ''),
    total: n(r.total),
    pending: n(r.pending),
    running: n(r.running),
    done: n(r.done),
    failed: n(r.failed),
    cancelled: n(r.cancelled),
    added: n(r.added),
    found: n(r.found),
    groupsWithNews: n(r.groups_with_news),
    failedNotes: notes.map((x) => ({ note: typeof x.note === 'string' ? x.note : null, n: n(x.n) })),
  };
}
