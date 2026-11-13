'use server';

import type { ActionResult as Result } from '@/lib/action-result';
import { requirePlatformAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { validDays, type RecoveryStatus } from '@/lib/history-recovery';
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
};

/** O pedido mais recente da conversa; request null = nunca pediu (ou o script 0178 ainda não foi aplicado). */
export async function latestPrivateRecovery(chatId: string): Promise<{ ok: true; request: HistoryRequestView | null } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('private_history_requests')
    .select('id, status, days, requests_sent, messages_found, messages_added, oldest_at, note, created_at, finished_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return /private_history_requests/.test(error.message) ? { ok: false, error: 'Falta aplicar o script do banco (item 0178).' } : { ok: false, error: friendlyDbError(error.message) };
  const r = data as Row | null;
  return {
    ok: true,
    request: r
      ? { id: r.id, status: r.status, days: r.days, requests: r.requests_sent, found: r.messages_found, added: r.messages_added, oldestAt: r.oldest_at, note: r.note, createdAt: r.created_at, finishedAt: r.finished_at }
      : null,
  };
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
