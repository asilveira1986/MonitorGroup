'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { validateRuleInput, type RuleInput, type RuleValues } from '@/lib/automation-rules';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

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
