'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import type { DetailsData } from '@/lib/indicators';
import { friendlyDbError } from '@/lib/db-errors';
import { recalcCompanyGroups } from '@/lib/recalc-groups';
import { createAdminClient, createClient } from '@/lib/supabase/server';

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

/** Mensagem sem remetente: marca à mão como de um atendente (ou do cliente, com null) e refaz o grupo (0078). */
export async function setMessageSender(messageId: string, teamMemberId: string | null): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_message_sender', { p_message_id: messageId, p_team_member_id: teamMemberId });
  revalidatePath('/', 'layout');
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

/** Meus alertas: liga/desliga os avisos (tela, voz e som) só para o usuário logado. */
export async function setMyAlertsOff(off: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_my_alerts_off', { p_off: off });
  revalidatePath('/', 'layout');
  return fail(error);
}

/** Editar (novo texto) ou apagar (para todos ou para mim) uma mensagem do número conectado: o worker faz no WhatsApp. */
export async function requestMessageAction(messageId: string, action: 'edit' | 'delete' | 'delete_me', body?: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_message_action', { p_message_id: messageId, p_action: action, p_body: body ?? null });
  return fail(error);
}

/** Responsáveis pelo grupo (somente admin): pessoas da equipe, ou nenhuma. */
export async function setGroupResponsibles(groupId: string, memberIds: string[]): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('groups').update({ responsible_member_ids: memberIds }).eq('id', groupId);
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
export type GroupAudio = { path: string; mime: string; size: number; voice: boolean };

export async function sendGroupMessage(
  groupId: string,
  body: string,
  quotedMessageId: string | null,
  closes = false,
  media: GroupAudio | null = null,
): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_body: body,
    p_quoted_message_id: quotedMessageId,
    // resposta com \fechamento: encerra a conversa do grupo
    p_closes: closes,
    // áudio gravado no painel (0074); sem ele, o banco antigo segue aceitando o texto
    ...(media ? { p_media: media } : {}),
  });
  return fail(error);
}

/**
 * Prepara o envio de um áudio no grupo: confere o grupo (com a sessão do usuário) e devolve um link
 * de upload direto para o Storage, na pasta do grupo. Quem pode responder confere o banco ao enviar.
 */
export async function prepareGroupAudioUpload(
  groupId: string,
  file: { ext: string; size: number },
): Promise<{ ok: true; data: { path: string; token: string } } | { ok: false; error: string }> {
  await requireProfile();
  if (file.size > 16 * 1024 * 1024) return { ok: false, error: 'O áudio passa de 16 MB.' };
  const supabase = await createClient();
  const { data: group } = await supabase.from('groups').select('id, company_id').eq('id', groupId).maybeSingle();
  if (!group) return { ok: false, error: 'Grupo não encontrado.' };
  const ext = file.ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'webm';
  const path = `${group.company_id}/${group.id}/out-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio do áudio.' };
  return { ok: true, data: { path, token: data.token } };
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
