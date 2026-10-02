'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
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
