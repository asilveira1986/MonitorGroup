'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import type { DetailsData } from '@/lib/indicators';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: { message: string } | null): Result => (error ? { ok: false, error: error.message } : { ok: true });

export async function markGroupAnswered(groupId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_group_answered', { p_group_id: groupId });
  revalidatePath('/', 'layout');
  return fail(error);
}

export async function setGroupMonitored(groupId: string, monitored: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('groups').update({ monitored }).eq('id', groupId);
  revalidatePath('/', 'layout');
  return fail(error);
}

export async function setGroupSla(groupId: string, slaMinutes: number | null): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from('groups')
    .update({ sla_minutes: slaMinutes && slaMinutes > 0 ? slaMinutes : null })
    .eq('id', groupId);
  revalidatePath(`/groups/${groupId}`);
  return fail(error);
}

export async function markSenderAsTeam(senderJid: string, name: string, phone: string | null): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_sender_as_team', {
    p_sender_jid: senderJid,
    p_name: name,
    p_phone: phone ?? '',
  });
  revalidatePath('/', 'layout');
  return fail(error);
}

export async function updateAlertStatus(alertId: string, status: 'acknowledged' | 'resolved'): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('alerts')
    .update(
      status === 'acknowledged'
        ? { status, acknowledged_by: profile.id, acknowledged_at: now }
        : { status, resolved_at: now, acknowledged_by: profile.id, acknowledged_at: now },
    )
    .eq('id', alertId);
  revalidatePath('/', 'layout');
  return fail(error);
}

export async function resolveAllAlerts(): Promise<Result> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('alerts')
    .update({ status: 'resolved', resolved_at: now, acknowledged_by: profile.id, acknowledged_at: now })
    .neq('status', 'resolved');
  revalidatePath('/', 'layout');
  return fail(error);
}

/** Exclusão definitiva de grupos que já saíram do WhatsApp (somente admin). */
export async function deleteRemovedGroups(groupIds: string[]): Promise<Result> {
  await requireAdmin();
  if (!groupIds.length) return { ok: false, error: 'Nenhum grupo selecionado.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_removed_groups', { p_group_ids: groupIds });
  revalidatePath('/', 'layout');
  return fail(error);
}

/** Lista do que compõe o número de um indicador (respeita os mesmos filtros do dashboard). */
export async function getIndicatorDetails(
  key: string,
  filters: { from: string; to: string; groupId: string | null; memberId: string | null },
): Promise<{ ok: true; data: DetailsData } | { ok: false; error: string }> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('indicator_details', {
    p_key: key,
    p_from: filters.from,
    p_to: filters.to,
    p_group_id: filters.groupId,
    p_member_id: filters.memberId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as DetailsData };
}
