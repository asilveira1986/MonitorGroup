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

/** Situação da fila de um pedido (para explicar por que ainda não começou): o número, o último sinal do worker e quantos pedidos vêm antes. */
export type QueueInfo = {
  instanceName: string | null;
  instanceStatus: string | null;
  /** último sinal do worker nesta conexão (heartbeat de 1 minuto) */
  instanceSeenAt: string | null;
  /** pedidos abertos (grupos e conversas) criados antes deste */
  ahead: number;
};

/** Sem sinal do worker há mais que isto (o heartbeat é de 1 minuto): ele pode estar parado ou reiniciando. */
const STALE_WORKER_MS = 3 * 60_000;

/** "há 12 s", "há 3 min", "há 2 h" */
export function ago(iso: string | null | undefined, nowMs: number): string | null {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

/** Linhas que explicam o que está acontecendo com um pedido na fila (tone: good = tudo certo, warning = precisa de atenção). */
export function queueHints(q: QueueInfo | null | undefined, nowMs: number): { tone: 'good' | 'warning'; text: string }[] {
  if (!q) return [];
  const out: { tone: 'good' | 'warning'; text: string }[] = [];
  const name = q.instanceName ? ` (${q.instanceName})` : '';
  if (q.instanceStatus !== 'connected') {
    out.push({ tone: 'warning', text: `O número conectado${name} está desconectado. Reconecte em Configurações › WhatsApp; o pedido segue sozinho.` });
    return out;
  }
  const seen = q.instanceSeenAt ? new Date(q.instanceSeenAt).getTime() : NaN;
  if (!Number.isFinite(seen) || nowMs - seen > STALE_WORKER_MS) {
    out.push({ tone: 'warning', text: `Sem sinal do worker ${ago(q.instanceSeenAt, nowMs) ?? 'recente'}: ele pode estar parado ou reiniciando. Confira o serviço do worker.` });
  } else {
    out.push({ tone: 'good', text: `Número conectado${name}; último sinal do worker ${ago(q.instanceSeenAt, nowMs)}.` });
  }
  if (q.ahead > 0) out.push({ tone: 'good', text: `${q.ahead} pedido(s) na frente na fila (o worker faz um de cada vez, os grupos antes das conversas privadas).` });
  else out.push({ tone: 'good', text: 'O worker deve assumir o pedido em até 30 segundos.' });
  return out;
}

/** Pedido em andamento sem nenhum sinal novo do worker há mais que isto: provavelmente parado. */
export const STALLED_RUNNING_MS = 3 * 60_000;
