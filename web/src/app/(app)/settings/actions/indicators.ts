'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createClient } from '@/lib/supabase/server';

export async function updateIndicator(
  key: string,
  changes: { enabled?: boolean; alert_enabled?: boolean; params?: Record<string, unknown> },
): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_indicator', {
    p_key: key,
    p_enabled: changes.enabled ?? null,
    p_alert_enabled: changes.alert_enabled ?? null,
    p_params: changes.params ?? null,
  });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function setIndicatorBlockEnabled(block: string, enabled: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_indicator_block_enabled', { p_block: block, p_enabled: enabled });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function resetIndicators(key: string | null): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_indicators', { p_key: key });
  revalidatePath('/', 'layout');
  return result(error);
}
