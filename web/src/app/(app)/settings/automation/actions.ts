'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult as Result } from '@/lib/action-result';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { validateGroupIds, validateRuleInput, type RuleInput, type RuleValues } from '@/lib/automation-rules';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

/** Campo do formulário -> coluna de automation_rules (0144). */
const COLUMNS: Record<keyof RuleValues, string> = {
  enabled: 'enabled',
  ackEnabled: 'ack_enabled',
  ackMessage: 'ack_message',
  ackOffHours: 'ack_off_hours',
  ackCooldownMin: 'ack_cooldown_min',
  notifyGroupJid: 'notify_group_jid',
  notifyGroupName: 'notify_group_name',
  escalateAfterMin: 'escalate_after_min',
  repeatEveryMin: 'repeat_every_min',
  maxEscalations: 'max_escalations',
  escalateOffHours: 'escalate_off_hours',
  mentionJids: 'mention_jids',
  businessDays: 'business_days',
  businessStart: 'business_start',
  businessEnd: 'business_end',
};

/**
 * Cria ou atualiza a regra de automação de um grupo (só administradores). Na criação o grupo interno é
 * obrigatório; só os campos editáveis passam, e horários e números são validados.
 */
export async function saveAutomationRule(groupId: string, input: RuleInput): Promise<Result> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from('automation_rules').select('id').eq('group_id', groupId).maybeSingle();
  if (readError) return { ok: false, error: friendlyDbError(readError.message) };

  const checked = validateRuleInput(input, { creating: !existing });
  if (!checked.ok) return checked;

  // o grupo do cliente precisa ser da empresa (a leitura respeita as permissões de quem pede)
  const { data: group } = await supabase.from('groups').select('id, jid').eq('id', groupId).maybeSingle();
  if (!group) return { ok: false, error: 'Grupo não encontrado.' };
  if (checked.value.notifyGroupJid && checked.value.notifyGroupJid === group.jid) {
    return { ok: false, error: 'O grupo interno precisa ser diferente do grupo do cliente.' };
  }

  const row = Object.fromEntries(Object.entries(checked.value).map(([key, value]) => [COLUMNS[key as keyof RuleValues], value]));
  const { error } = existing
    ? await supabase.from('automation_rules').update({ ...row, updated_at: new Date().toISOString() }).eq('group_id', groupId)
    : await supabase.from('automation_rules').insert({ ...row, group_id: groupId, company_id: profile.company_id });
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/**
 * Cria ou atualiza a MESMA regra para vários grupos de uma vez (só administradores), por exemplo todos os grupos de
 * um setor com o grupo interno desse setor. O grupo interno é obrigatório; grupos que já são o grupo interno de
 * alguma regra, ou o próprio grupo interno escolhido, ficam de fora (contados em `skipped`).
 */
export async function saveAutomationRules(groupIds: string[], input: RuleInput): Promise<Result & { saved?: number; skipped?: number }> {
  const profile = await requireAdmin();
  const ids = validateGroupIds(groupIds);
  if (!ids.ok) return ids;
  const checked = validateRuleInput(input, { creating: true });
  if (!checked.ok) return checked;
  const notifyJid = checked.value.notifyGroupJid!;

  const supabase = await createClient();
  const [{ data: groups, error: groupsError }, { data: used }] = await Promise.all([
    supabase.from('groups').select('id, jid').in('id', ids.value),
    supabase.from('automation_rules').select('notify_group_jid'),
  ]);
  if (groupsError) return { ok: false, error: friendlyDbError(groupsError.message) };
  const found = groups ?? [];
  if (found.length !== ids.value.length) return { ok: false, error: 'Algum grupo não foi encontrado.' };
  const internal = new Set([notifyJid, ...((used ?? []) as { notify_group_jid: string }[]).map((r) => r.notify_group_jid)]);
  const targets = found.filter((g) => !internal.has(g.jid));
  if (!targets.length) return { ok: false, error: 'Os grupos escolhidos já são grupos internos. Escolha grupos de clientes.' };

  const row = Object.fromEntries(Object.entries(checked.value).map(([key, value]) => [COLUMNS[key as keyof RuleValues], value]));
  const at = new Date().toISOString();
  const { error } = await supabase
    .from('automation_rules')
    .upsert(targets.map((g) => ({ ...row, group_id: g.id, company_id: profile.company_id, updated_at: at })), { onConflict: 'group_id' });
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true, saved: targets.length, skipped: found.length - targets.length };
}

/** Liga ou desliga a automação de vários grupos de uma vez (só administradores). */
export async function setAutomationRulesEnabled(groupIds: string[], enabled: boolean): Promise<Result> {
  await requireAdmin();
  const ids = validateGroupIds(groupIds);
  if (!ids.ok) return ids;
  const supabase = await createClient();
  const { error } = await supabase
    .from('automation_rules')
    .update({ enabled, updated_at: new Date().toISOString() })
    .in('group_id', ids.value);
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Remove as regras de vários grupos de uma vez (só administradores). */
export async function deleteAutomationRules(groupIds: string[]): Promise<Result> {
  await requireAdmin();
  const ids = validateGroupIds(groupIds);
  if (!ids.ok) return ids;
  const supabase = await createClient();
  const { error } = await supabase.from('automation_rules').delete().in('group_id', ids.value);
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/**
 * Chave geral da automação de atendimento (só administradores): desligada, o worker não responde, não avisa nem
 * cobra. As regras e as demandas abertas ficam guardadas. Começa desligada.
 */
export async function setAutomationEnabled(enabled: boolean): Promise<Result> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ automation_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('company_id', profile.company_id);
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Remove a regra do grupo: a automação deixa de agir nele (as demandas já encerradas continuam no histórico). */
export async function deleteAutomationRule(groupId: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('automation_rules').delete().eq('group_id', groupId);
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Encerramento manual de uma demanda (quem pode tratar alertas do grupo): tira o alerta da tela e registra quem encerrou. */
export async function resolveAutomationPending(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_automation_pending', { p_id: id });
  revalidatePath('/settings/automation');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
