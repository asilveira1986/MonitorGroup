'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult as Result } from '@/lib/action-result';
import { requirePlatformAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

/** Exclui grupos da empresa (em atividade ou já excluídos do WhatsApp) com tudo o que tem dentro: só o administrador geral (0181). */
export async function deleteGroupsAsPlatform(groupIds: string[]): Promise<Result> {
  await requirePlatformAdmin();
  if (!groupIds.length) return { ok: false, error: 'Nenhum grupo selecionado.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_groups_platform', { p_group_ids: groupIds });
  if (error) return { ok: false, error: /delete_groups_platform/.test(error.message) ? 'Falta aplicar o script do banco (item 0181).' : friendlyDbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true };
}
