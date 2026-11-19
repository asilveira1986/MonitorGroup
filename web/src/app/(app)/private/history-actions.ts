'use server';

import type { ActionResult as Result } from '@/lib/action-result';
import { requirePlatformAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { parseBatchStatus, validDays, type BatchStatus, type QueueInfo, type RecoveryStatus } from '@/lib/history-recovery';
import { createClient } from '@/lib/supabase/server';
import type { HistoryRequestView } from '../groups/history-actions';

/** Recuperar mensagens antigas de uma conversa privada (0178): só o administrador geral da plataforma. */
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
  updated_at: string | null;
};

/** O pedido mais recente da conversa; request null = nunca pediu (ou o script 0178 ainda não foi aplicado). Com o pedido na fila, traz também por que ainda não começou. */
export async function latestPrivateRecovery(
  chatId: string,
): Promise<{ ok: true; request: HistoryRequestView | null; queue: QueueInfo | null } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('private_history_requests')
    .select('id, status, days, requests_sent, messages_found, messages_added, oldest_at, note, created_at, finished_at, updated_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return /private_history_requests/.test(error.message) ? { ok: false, error: 'Falta aplicar o script do banco (item 0178).' } : { ok: false, error: friendlyDbError(error.message) };
  const r = data as Row | null;
  if (!r) return { ok: true, request: null, queue: null };
  const request: HistoryRequestView = {
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
    updatedAt: r.updated_at,
  };
  // pedido na fila: mostra a conexão do número, o último sinal do worker e quantos pedidos vêm antes
  let queue: QueueInfo | null = null;
  if (r.status === 'pending') {
    const [{ data: chat }, privAhead, groupAhead] = await Promise.all([
      supabase.from('private_chats').select('whatsapp_instances(name, status, last_seen_at)').eq('id', chatId).maybeSingle(),
      supabase.from('private_history_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'running']).lt('created_at', r.created_at),
      supabase.from('history_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'running']),
    ]);
    const raw = (chat as { whatsapp_instances?: unknown } | null)?.whatsapp_instances;
    const inst = (Array.isArray(raw) ? raw[0] : raw) as { name?: string | null; status?: string | null; last_seen_at?: string | null } | null | undefined;
    queue = {
      instanceName: inst?.name ?? null,
      instanceStatus: inst?.status ?? null,
      instanceSeenAt: inst?.last_seen_at ?? null,
      ahead: (privAhead.count ?? 0) + (groupAhead.count ?? 0),
    };
  }
  return { ok: true, request, queue };
}

export async function startPrivateRecovery(chatId: string, days: number): Promise<Result> {
  await requirePlatformAdmin();
  if (!validDays(days)) return { ok: false, error: 'Escolha um período de 1 a 30 dias.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_private_history_recovery', { p_chat_id: chatId, p_days: days });
  if (error) return /request_private_history_recovery/.test(error.message) ? { ok: false, error: 'Falta aplicar o script do banco (item 0178).' } : { ok: false, error: friendlyDbError(error.message) };
  return { ok: true };
}

export async function cancelPrivateRecovery(id: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_private_history_recovery', { p_id: id });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

// ------------------------------------------------------------ todas as conversas (0191)

/** Pede a recuperação de todas as conversas privadas da empresa (um pedido por conversa; o worker faz um de cada vez). */
export async function startPrivateRecoveryAll(days: number, onlyOpen: boolean): Promise<Result & { created?: number; skipped?: number }> {
  await requirePlatformAdmin();
  if (!validDays(days)) return { ok: false, error: 'Escolha um período de 1 a 30 dias.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_private_history_recovery_all', { p_days: days, p_only_open: onlyOpen });
  if (error) return /request_private_history_recovery_all/.test(error.message) ? { ok: false, error: 'Falta aplicar o script do banco (item 0191).' } : { ok: false, error: friendlyDbError(error.message) };
  const r = (data ?? {}) as { created?: number; skipped?: number };
  return { ok: true, created: r.created ?? 0, skipped: r.skipped ?? 0 };
}

/** Andamento do pedido em lote mais recente (mesmo formato do dos grupos). */
export async function privateRecoveryBatchStatus(): Promise<{ ok: true; status: BatchStatus | null } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('private_history_recovery_batch_status');
  if (error) return /private_history_recovery_batch_status/.test(error.message) ? { ok: false, error: 'Falta aplicar o script do banco (item 0191).' } : { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, status: parseBatchStatus(data) };
}

/** Cancela o que ainda não terminou no lote (as conversas já concluídas ficam como estão). */
export async function cancelPrivateRecoveryBatch(batchId: string): Promise<Result & { cancelled?: number }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_private_history_recovery_batch', { p_batch: batchId });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, cancelled: Number(data ?? 0) };
}
