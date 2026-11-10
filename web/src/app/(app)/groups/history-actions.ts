'use server';

import type { ActionResult as Result } from '@/lib/action-result';
import { requireAdmin, requirePlatformAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { parseBatchStatus, validDays, type BatchStatus, type RecoveryStatus } from '@/lib/history-recovery';
import type { ReceiveDiagnosis } from '@/lib/receive-diagnosis';
import { createClient } from '@/lib/supabase/server';

/** Pedido de recuperação de mensagens antigas (0161). */
export type HistoryRequestView = {
  id: string;
  status: RecoveryStatus;
  days: number;
  requests: number;
  found: number;
  added: number;
  oldestAt: string | null;
  note: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  status: RecoveryStatus;
  days: number;
  requests_sent: number;
  messages_found: number;
  messages_added: number;
  oldest_at: string | null;
  note: string | null;
  created_at: string;
  finished_at: string | null;
};

const view = (r: Row): HistoryRequestView => ({
  id: r.id,
  status: r.status,
  days: r.days,
  requests: r.requests_sent,
  found: r.messages_found,
  added: r.messages_added,
  oldestAt: r.oldest_at,
  note: r.note,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

/** O pedido mais recente do grupo (só administradores). */
export async function latestHistoryRecovery(groupId: string): Promise<{ ok: true; request: HistoryRequestView | null } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('history_requests')
    .select('id, status, days, requests_sent, messages_found, messages_added, oldest_at, note, created_at, finished_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, request: data ? view(data as Row) : null };
}

/** Diagnóstico de recebimento do grupo (0165, só administradores); null = script do banco ainda não aplicado. */
export async function groupReceiveDiagnosis(groupId: string): Promise<{ ok: true; diagnosis: ReceiveDiagnosis | null } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('group_receive_diagnosis', { p_group_id: groupId });
  if (error) {
    if (/group_receive_diagnosis/.test(error.message)) return { ok: true, diagnosis: null };
    return { ok: false, error: friendlyDbError(error.message) };
  }
  return { ok: true, diagnosis: (data as ReceiveDiagnosis | null) ?? null };
}

/** Traz agora, das outras cópias do grupo (outros números), as mensagens que esta não tem (0166). */
export async function syncGroupCopies(groupId: string): Promise<Result & { added?: number }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('sync_group_copies', { p_group_id: groupId, p_days: 30 });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, added: Number((data as { added?: number } | null)?.added ?? 0) };
}

export async function startHistoryRecovery(groupId: string, days: number): Promise<Result> {
  await requireAdmin();
  if (!validDays(days)) return { ok: false, error: 'Escolha um período de 1 a 30 dias.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_history_recovery', { p_group_id: groupId, p_days: days });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

export async function cancelHistoryRecovery(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_history_recovery', { p_id: id });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

// ------------------------------------------------------------ todos os grupos (administrador geral da plataforma)

/** Pede a recuperação de todos os grupos ativos da empresa (um pedido por grupo, o worker faz um de cada vez). */
export async function startHistoryRecoveryAll(days: number, onlyUnmonitored: boolean): Promise<Result & { created?: number; skipped?: number }> {
  await requirePlatformAdmin();
  if (!validDays(days)) return { ok: false, error: 'Escolha um período de 1 a 30 dias.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_history_recovery_all', { p_days: days, p_only_unmonitored: onlyUnmonitored });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  const r = (data ?? {}) as { created?: number; skipped?: number };
  return { ok: true, created: r.created ?? 0, skipped: r.skipped ?? 0 };
}

/** Andamento do pedido em lote mais recente da empresa. */
export async function historyRecoveryBatchStatus(): Promise<{ ok: true; status: BatchStatus | null } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('history_recovery_batch_status');
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, status: parseBatchStatus(data) };
}

/** Cancela o que ainda não terminou no pedido em lote (os já concluídos ficam como estão). */
export async function cancelHistoryRecoveryBatch(batchId: string): Promise<Result & { cancelled?: number }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_history_recovery_batch', { p_batch: batchId });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, cancelled: Number(data ?? 0) };
}
