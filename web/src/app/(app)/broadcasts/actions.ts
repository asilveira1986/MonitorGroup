'use server';

import { revalidatePath } from 'next/cache';
import { dbResult, type ActionResult } from '@/lib/action-result';
import { requireAdmin } from '@/lib/auth';
import { validateBroadcastSettings, type BroadcastFilter, type BroadcastRecipient, type BroadcastSettingsValues } from '@/lib/broadcast';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

/** Público do filtro (0150): total exato e as primeiras linhas para a revisão e para a escolha manual. */
export async function previewAudience(
  filter: BroadcastFilter,
  opts: { limit?: number; search?: string } = {},
): Promise<{ ok: true; total: number; rows: BroadcastRecipient[] } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('broadcast_preview', {
    p_filter: filter,
    p_limit: Math.min(Math.max(opts.limit ?? 500, 0), 1000),
    p_search: opts.search?.trim() || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  const out = data as { total: number; rows: BroadcastRecipient[] } | null;
  return { ok: true, total: Number(out?.total ?? 0), rows: out?.rows ?? [] };
}

export type NewBroadcast = {
  name: string;
  filter: BroadcastFilter;
  message: string;
  instanceId: string | null;
  /** ISO; vazio = enviar agora */
  scheduledAt: string | null;
  /** destinatários desmarcados na revisão (id do grupo ou telefone) */
  skip: string[];
};

/** Cria o disparo (envia agora ou agenda) com o público do filtro, menos os desmarcados. */
export async function createBroadcast(input: NewBroadcast): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireAdmin();
  const when = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (when && Number.isNaN(when.getTime())) return { ok: false, error: 'Data de envio inválida.' };
  if (when && when.getTime() < Date.now() - 60_000) return { ok: false, error: 'A data de envio já passou.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('broadcast_create', {
    p_name: input.name,
    p_filter: input.filter,
    p_message: input.message,
    p_instance_id: input.filter.target === 'people' ? input.instanceId : null,
    p_scheduled_at: when ? when.toISOString() : null,
    p_skip: input.skip,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  return { ok: true, id: data as string };
}

/** Pausa, retoma ou cancela um disparo. */
export async function setBroadcastStatus(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_set_status', { p_id: id, p_action: action });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  revalidatePath(`/broadcasts/${id}`);
  return { ok: true };
}

/** Ritmo de envio da empresa (intervalos, lotes e limite de 24 horas). */
export async function saveBroadcastSettings(values: BroadcastSettingsValues): Promise<ActionResult> {
  const profile = await requireAdmin();
  const checked = validateBroadcastSettings(values);
  if (!checked.ok) return checked;
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      broadcast_min_delay_s: values.minDelayS,
      broadcast_max_delay_s: values.maxDelayS,
      broadcast_batch_size: values.batchSize,
      broadcast_batch_pause_min: values.batchPauseMin,
      broadcast_daily_limit: values.dailyLimit,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  if (error) return dbResult(error);
  revalidatePath('/broadcasts');
  return { ok: true };
}
