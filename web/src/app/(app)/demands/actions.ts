'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { DemandStatus } from '@/lib/types';

type Result = { ok: true } | { ok: false; error: string };
const result = (error: { message: string } | null | undefined): Result =>
  error ? { ok: false, error: error.message } : { ok: true };

const isoOrNull = (v: FormDataEntryValue | string | null | undefined) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Cria uma demanda (manual). Aceita uma mensagem de origem. */
export async function createDemand(input: {
  groupId: string;
  description: string;
  messageId?: string | null;
  type?: string | null;
  assigneeId?: string | null;
  promisedAt?: string | null;
}): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_demand', {
    p_group_id: input.groupId,
    p_description: input.description,
    p_message_id: input.messageId || null,
    p_type: input.type || null,
    p_assignee_id: input.assigneeId || null,
    p_promised_at: isoOrNull(input.promisedAt),
    p_source: 'manual',
    p_actor: profile.full_name || profile.email,
  });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function updateDemand(
  id: string,
  changes: {
    status?: DemandStatus;
    assignee_id?: string | null;
    promised_at?: string | null;
    description?: string;
    type?: string | null;
    confirmed?: boolean;
  },
): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const payload: Record<string, unknown> = { ...changes };
  if ('promised_at' in changes) payload.promised_at = isoOrNull(changes.promised_at);
  const { error } = await supabase.rpc('update_demand', {
    p_id: id,
    p_changes: payload,
    p_actor: profile.full_name || profile.email,
  });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function registerFollowup(id: string): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('register_demand_followup', {
    p_id: id,
    p_actor: profile.full_name || profile.email,
  });
  revalidatePath('/', 'layout');
  return result(error);
}

/** Origens de demanda (somente admin). */
export async function saveDemandSettings(values: {
  manual: boolean;
  command: boolean;
  keyword: boolean;
  keywords: string[];
  ai: boolean;
  commitment: boolean;
  commitmentKeywords: string[];
}): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      demand_manual_enabled: values.manual,
      demand_command_enabled: values.command,
      demand_keyword_enabled: values.keyword,
      demand_keywords: values.keywords.map((k) => k.trim()).filter(Boolean),
      demand_ai_enabled: values.ai,
      demand_commitment_enabled: values.commitment,
      demand_commitment_keywords: values.commitmentKeywords.map((k) => k.trim()).filter(Boolean),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  revalidatePath('/', 'layout');
  return result(error);
}
