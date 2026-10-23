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
  commitmentVerbs: string[];
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
      demand_commitment_verbs: values.commitmentVerbs.map((k) => k.trim().toLowerCase()).filter(Boolean),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/** Avisos ao cliente (0091 registro, 0092 conclusão): liga/desliga e o texto (vazio = o padrão). */
export async function saveDemandNotice(values: { kind?: 'created' | 'done'; enabled: boolean; template: string }): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const done = values.kind === 'done';
  const { error } = await supabase
    .from('app_settings')
    .update({
      [done ? 'demand_done_notify' : 'demand_notify_client']: values.enabled,
      [done ? 'demand_done_template' : 'demand_notify_template']: values.template.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', admin.company_id);
  revalidatePath('/settings/demand-types');
  return result(error);
}

/**
 * "Demanda entregue" com observação opcional (0092): a observação vai no aviso de conclusão ao
 * cliente. Sem o script, só marca a entrega.
 */
export async function deliverDemand(id: string, note: string): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const actor = profile.full_name || profile.email;
  const { error } = await supabase.rpc('deliver_demand', { p_id: id, p_note: note.trim() || null, p_actor: actor });
  if (error && /deliver_demand/.test(error.message)) {
    const r = await supabase.rpc('update_demand', { p_id: id, p_changes: { status: 'entregue' }, p_actor: actor });
    revalidatePath('/', 'layout');
    return result(r.error);
  }
  revalidatePath('/', 'layout');
  return result(error);
}
