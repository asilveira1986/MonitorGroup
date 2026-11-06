'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createClient } from '@/lib/supabase/server';

export async function createInstance(name: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('whatsapp_instances')
    .insert({ name: name.trim() || 'WhatsApp', requested_action: 'connect', status: 'connecting' });
  revalidatePath('/settings/whatsapp');
  return result(error);
}

export async function requestInstanceAction(id: string, action: 'connect' | 'logout' | 'reimport'): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('whatsapp_instances')
    .update({
      requested_action: action,
      ...(action !== 'logout' ? { status: 'connecting', last_error: null } : {}),
    })
    .eq('id', id);
  revalidatePath('/settings/whatsapp');
  return result(error);
}

export async function deleteInstance(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('whatsapp_instances').delete().eq('id', id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function saveMediaSettings(values: { enabled: boolean; types: string[]; days: number; avatars: boolean }): Promise<Result> {
  const profile = await requireAdmin();
  const allowed = ['image', 'audio', 'sticker', 'video', 'document'];
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      media_store_enabled: values.enabled,
      media_store_types: allowed.filter((t) => values.types.includes(t)),
      media_retention_days: [30, 60, 90, 180, 365, 0].includes(values.days) ? values.days : 90,
      avatars_enabled: values.avatars,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/**
 * Setor do número de WhatsApp (0121): as conversas privadas dele vão para o setor, e os grupos dele que
 * estão no setor padrão também (0122). Devolve quantos grupos mudaram de setor.
 */
export async function setInstanceSector(instanceId: string, sectorId: string | null): Promise<Result & { moved?: number }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_instance_sector', { p_instance: instanceId, p_sector: sectorId });
  revalidatePath('/settings/whatsapp');
  revalidatePath('/private');
  revalidatePath('/groups');
  revalidatePath('/panel');
  return error ? result(error) : { ok: true, moved: typeof data === 'number' ? data : 0 };
}
