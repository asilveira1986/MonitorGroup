'use server';

import { revalidatePath } from 'next/cache';
import { dbResult, type ActionResult } from '@/lib/action-result';
import { requirePlatformAdmin } from '@/lib/auth';
import {
  MAX_MEDIA_BYTES,
  mediaTypeFromMime,
  validateBroadcastSettings,
  validateRecurrence,
  validateTrigger,
  validateWindow,
  type BroadcastFilter,
  type BroadcastMedia,
  type BroadcastRecipient,
  type BroadcastSettingsValues,
  type BroadcastWindow,
  type Recurrence,
  type TriggerInput,
} from '@/lib/broadcast';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/** Público do filtro (0150): total exato e as primeiras linhas para a revisão e para a escolha manual. */
export async function previewAudience(
  filter: BroadcastFilter,
  opts: { limit?: number; search?: string } = {},
): Promise<{ ok: true; total: number; rows: BroadcastRecipient[] } | { ok: false; error: string }> {
  await requirePlatformAdmin();
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
  /** textos alternativos (cada destinatário recebe um deles ou o principal) */
  variants?: string[];
  /** arquivo já enviado ao Storage (prepareBroadcastUpload) */
  media?: BroadcastMedia | null;
  /** só enviar nesses dias e horas */
  window?: BroadcastWindow | null;
  /** rodapé "responda SAIR" nas mensagens a pessoas */
  optoutFooter?: boolean;
  /** repete o disparo (o público é recalculado a cada envio); scheduledAt vira "a partir de" */
  recurrence?: Recurrence | null;
};

/** Cria o disparo (envia agora ou agenda) com o público do filtro, menos os desmarcados. */
export async function createBroadcast(input: NewBroadcast): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const when = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (when && Number.isNaN(when.getTime())) return { ok: false, error: 'Data de envio inválida.' };
  if (when && when.getTime() < Date.now() - 60_000) return { ok: false, error: 'A data de envio já passou.' };
  if (input.window) {
    const w = validateWindow(input.window);
    if (!w.ok) return w;
  }
  if (input.recurrence) {
    const r = validateRecurrence(input.recurrence);
    if (!r.ok) return r;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('broadcast_create', {
    p_name: input.name,
    p_filter: input.filter,
    p_message: input.message,
    p_instance_id: input.filter.target === 'people' ? input.instanceId : null,
    p_scheduled_at: when ? when.toISOString() : null,
    // numa série o público é recalculado a cada envio: as marcações da revisão não valem
    p_skip: input.recurrence ? [] : input.skip,
    p_variants: input.variants ?? [],
    p_media: input.media ?? null,
    p_window: input.window ?? null,
    p_optout_footer: input.optoutFooter ?? true,
    p_recurrence: input.recurrence ?? null,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  return { ok: true, id: data as string };
}

/** Pausa, retoma ou cancela um disparo. */
export async function setBroadcastStatus(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_set_status', { p_id: id, p_action: action });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  revalidatePath(`/broadcasts/${id}`);
  return { ok: true };
}

/** Ritmo de envio da empresa (intervalos, lotes e limite de 24 horas). */
export async function saveBroadcastSettings(values: BroadcastSettingsValues): Promise<ActionResult> {
  const profile = await requirePlatformAdmin();
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

/**
 * Prepara o envio de um arquivo para o disparo: devolve um link de upload direto para o Storage, na pasta da
 * empresa (o arquivo não passa pelo servidor).
 */
export async function prepareBroadcastUpload(file: { name: string; mime: string; size: number }): Promise<{ ok: true; media: BroadcastMedia; token: string } | { ok: false; error: string }> {
  const profile = await requirePlatformAdmin();
  if (!profile.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  if (file.size > MAX_MEDIA_BYTES) return { ok: false, error: 'O arquivo passa de 50 MB.' };
  if (file.size <= 0) return { ok: false, error: 'O arquivo está vazio.' };
  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : (file.mime.split('/')[1] ?? 'bin')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const path = `${profile.company_id}/broadcast/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio do arquivo.' };
  const mime = file.mime || 'application/octet-stream';
  return { ok: true, token: data.token, media: { path, mime, name: file.name.slice(0, 120), type: mediaTypeFromMime(mime) } };
}

/** Devolve as falhas do disparo para a fila (as que "ficaram enviando" por uma queda não voltam: poderiam duplicar). */
export async function retryBroadcastFailures(id: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('broadcast_retry_failed', { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  revalidatePath(`/broadcasts/${id}`);
  return { ok: true, count: Number(data ?? 0) };
}

/** Salva o filtro atual como um público para reutilizar (mesmo nome atualiza o que já existe). */
export async function saveBroadcastAudience(name: string, filter: BroadcastFilter): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('broadcast_audience_save', { p_name: name, p_filter: filter });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts/new');
  return { ok: true, id: data as string };
}

export async function deleteBroadcastAudience(id: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_audience_delete', { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts/new');
  return { ok: true };
}

/** Quem não deve receber disparos (opt-out cadastrado à mão). */
export async function addBroadcastOptout(phone: string, name: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_optout_add', { p_phone: phone, p_name: name || null });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  return { ok: true };
}

export async function removeBroadcastOptout(id: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_optout_remove', { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts');
  return { ok: true };
}

/** Cria um gatilho: etiqueta aplicada (envia uma vez a quem recebe a etiqueta) ou aniversário (no dia, no horário). */
export async function saveBroadcastTrigger(input: TriggerInput): Promise<ActionResult> {
  await requirePlatformAdmin();
  const checked = validateTrigger(input);
  if (!checked.ok) return checked;
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_trigger_save', {
    p_name: input.name,
    p_kind: input.kind,
    p_tag_id: input.kind === 'tag_applied' ? input.tagId : null,
    p_send_time: input.sendTime,
    p_target: input.target,
    p_instance_id: input.target === 'people' || input.kind === 'birthday' ? input.instanceId : null,
    p_message: input.message,
    p_optout_footer: input.optoutFooter,
    p_include_existing: input.includeExisting,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts/triggers');
  return { ok: true };
}

export async function setBroadcastTriggerEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_trigger_set_enabled', { p_id: id, p_enabled: enabled });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts/triggers');
  return { ok: true };
}

export async function deleteBroadcastTrigger(id: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('broadcast_trigger_delete', { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/broadcasts/triggers');
  return { ok: true };
}
