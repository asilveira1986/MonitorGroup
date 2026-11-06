'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult as Result } from '@/lib/action-result';
import { requireAdmin } from '@/lib/auth';
import { validateClosingFlow, type ClosingFlowInput } from '@/lib/closing-flows';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Cria (sem `id`) ou atualiza uma regra de mensagem de encerramento (só administradores). */
export async function saveClosingFlow(id: string | null, input: ClosingFlowInput): Promise<Result> {
  const profile = await requireAdmin();
  if (id !== null && !isUuid(id)) return { ok: false, error: 'Regra inválida.' };
  const checked = validateClosingFlow(input);
  if (!checked.ok) return checked;
  const v = checked.value;

  const supabase = await createClient();
  // os grupos precisam ser da empresa (a leitura respeita as permissões de quem pede)
  const { data: groups, error: groupsError } = await supabase.from('groups').select('id, jid').in('id', v.groupIds);
  if (groupsError) return { ok: false, error: friendlyDbError(groupsError.message) };
  if ((groups ?? []).length !== v.groupIds.length) return { ok: false, error: 'Algum grupo não foi encontrado.' };
  if (v.notifyGroupJid && (groups ?? []).some((g) => g.jid === v.notifyGroupJid)) {
    return { ok: false, error: 'O grupo interno precisa ser diferente dos grupos dos clientes.' };
  }

  const row = {
    name: v.name,
    enabled: v.enabled,
    question: v.question,
    options: v.options,
    group_ids: v.groupIds,
    delay_min: v.delayMin,
    expire_hours: v.expireHours,
    notify_group_jid: v.notifyGroupJid,
    notify_group_name: v.notifyGroupName,
    mention_jids: v.mentionJids,
    updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await supabase.from('closing_flows').update(row).eq('id', id)
    : await supabase.from('closing_flows').insert({ ...row, company_id: profile.company_id });
  revalidatePath('/settings/closing');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Liga ou desliga uma regra (só administradores). */
export async function setClosingFlowEnabled(id: string, enabled: boolean): Promise<Result> {
  await requireAdmin();
  if (!isUuid(id)) return { ok: false, error: 'Regra inválida.' };
  const supabase = await createClient();
  const { error } = await supabase.from('closing_flows').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/settings/closing');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Exclui uma regra: o que já foi enviado continua no histórico (só administradores). */
export async function deleteClosingFlow(id: string): Promise<Result> {
  await requireAdmin();
  if (!isUuid(id)) return { ok: false, error: 'Regra inválida.' };
  const supabase = await createClient();
  const { error } = await supabase.from('closing_flows').delete().eq('id', id);
  revalidatePath('/settings/closing');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
