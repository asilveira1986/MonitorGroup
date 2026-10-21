'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import type { DetailsData } from '@/lib/indicators';
import { friendlyDbError } from '@/lib/db-errors';
import { recalcCompanyGroups } from '@/lib/recalc-groups';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: { message: string } | null): Result =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };

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
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_sender_as_team', {
    p_sender_jid: senderJid,
    p_name: name,
    p_phone: phone ?? '',
  });
  // os grupos em que a pessoa já tinha respondido saem de "aguardando"
  if (!error) await recalcCompanyGroups(profile.company_id);
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
  let query = supabase
    .from('alerts')
    .update({ status: 'resolved', resolved_at: now, acknowledged_by: profile.id, acknowledged_at: now })
    .neq('status', 'resolved');
  // fora do administrador, só os alertas que o setor pode tratar (e os sem grupo)
  if (profile.role !== 'admin') {
    const { data } = await supabase.rpc('my_permissions');
    const ids = ((data as { alert_groups?: string[] } | null)?.alert_groups ?? []).join(',');
    query = ids ? query.or(`group_id.is.null,group_id.in.(${ids})`) : query.is('group_id', null);
  }
  const { error } = await query;
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

/** Muda o setor do grupo (somente admin; o banco também confere). */
export async function setGroupSector(groupId: string, sectorId: string | null): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('groups').update({ sector_id: sectorId }).eq('id', groupId);
  revalidatePath('/', 'layout');
  return fail(error);
}

/** Silenciar / reativar os avisos de um tipo de alerta (until null = reativar; 'infinity' = sempre). */
export async function setAlertTypeMute(type: string, until: string | null): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_alert_type_mute', { p_type: type, p_until: until });
  revalidatePath('/alerts');
  return fail(error);
}

/** Responsável pelo grupo (somente admin): uma pessoa da equipe, ou nenhum. */
export async function setGroupResponsible(groupId: string, memberId: string | null): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('groups').update({ responsible_member_id: memberId }).eq('id', groupId);
  revalidatePath('/', 'layout');
  return fail(error);
}

/** Dá baixa num arquivo recebido (ou em todos os arquivos sem visualização do grupo). */
export async function markMediaSeen(target: { messageId?: string; groupId?: string }): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_media_seen', {
    p_message_id: target.messageId ?? null,
    p_group_id: target.groupId ?? null,
  });
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

// ---------------------------------------------------------------------
// Responder pelo painel (a fila é enviada pelo worker)
// ---------------------------------------------------------------------
export async function sendGroupMessage(
  groupId: string,
  body: string,
  quotedMessageId: string | null,
  closes = false,
): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_body: body,
    p_quoted_message_id: quotedMessageId,
    // resposta com \fechamento: encerra a conversa do grupo
    p_closes: closes,
  });
  return fail(error);
}

export async function retryGroupMessage(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('retry_group_message', { p_id: id });
  return fail(error);
}

export async function discardGroupMessage(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('discard_group_message', { p_id: id });
  return fail(error);
}
