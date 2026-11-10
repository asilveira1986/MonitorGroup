'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult as Result } from '@/lib/action-result';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

/** "Não está pendente" (0167): tira a pendência da conversa; só as mensagens seguintes voltam a contar. */
export async function dismissGroupFollowup(groupId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('dismiss_group_followup', { p_group_id: groupId });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath(`/groups/${groupId}`);
  revalidatePath('/panel');
  return { ok: true };
}
