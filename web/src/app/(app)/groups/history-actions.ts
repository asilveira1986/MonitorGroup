'use server';

import type { ActionResult as Result } from '@/lib/action-result';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { validDays, type RecoveryStatus } from '@/lib/history-recovery';
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
