'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createClient } from '@/lib/supabase/server';

export type SectorInput = {
  name: string;
  description: string;
  can_reply: boolean;
  can_manage_demands: boolean;
  can_handle_alerts: boolean;
};

const cleanSector = (v: SectorInput) => ({
  name: v.name.trim(),
  description: v.description.trim() || null,
  can_reply: Boolean(v.can_reply),
  can_manage_demands: Boolean(v.can_manage_demands),
  can_handle_alerts: Boolean(v.can_handle_alerts),
});

export async function createSector(values: SectorInput): Promise<Result & { id?: string }> {
  await requireAdmin();
  const row = cleanSector(values);
  if (!row.name) return { ok: false, error: 'Informe o nome do setor.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('sectors').insert(row).select('id').single();
  revalidatePath('/', 'layout');
  if (error) return result(error.code === '23505' ? { message: 'Já existe um setor com esse nome.' } : error);
  return { ok: true, id: data.id as string };
}

/**
 * Salva o setor: dados, permissões e só o que mudou nos usuários e grupos deste cartão
 * (assim um cartão aberto há mais tempo não desfaz o que outro setor acabou de salvar).
 * Um grupo pertence a um setor só: incluir aqui tira o grupo do setor anterior.
 */
export async function saveSector(
  id: string,
  values: SectorInput & { addMembers: string[]; removeMembers: string[]; addGroups: string[]; removeGroups: string[] },
): Promise<Result> {
  await requireAdmin();
  const row = cleanSector(values);
  if (!row.name) return { ok: false, error: 'Informe o nome do setor.' };
  const supabase = await createClient();

  const { error: e1 } = await supabase.from('sectors').update(row).eq('id', id);
  if (e1) return result(e1.code === '23505' ? { message: 'Já existe um setor com esse nome.' } : e1);

  if (values.removeMembers.length) {
    const { error } = await supabase.from('sector_members').delete().eq('sector_id', id).in('user_id', values.removeMembers);
    if (error) return result(error);
  }
  if (values.addMembers.length) {
    const { error } = await supabase
      .from('sector_members')
      .upsert(values.addMembers.map((user_id) => ({ sector_id: id, user_id })), {
        onConflict: 'sector_id,user_id',
        ignoreDuplicates: true,
      });
    if (error) return result(error);
  }
  // desmarcados: ficam sem setor (só se ainda estiverem neste setor)
  if (values.removeGroups.length) {
    const { error } = await supabase.from('groups').update({ sector_id: null }).eq('sector_id', id).in('id', values.removeGroups);
    if (error) return result(error);
  }
  if (values.addGroups.length) {
    const { error } = await supabase.from('groups').update({ sector_id: id }).in('id', values.addGroups);
    if (error) return result(error);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function deleteSector(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('sectors').delete().eq('id', id);
  revalidatePath('/', 'layout');
  return result(error);
}

/** Setor que os grupos novos recebem automaticamente (null = nenhum: só administradores veem). */
export async function setDefaultSector(id: string | null): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('app_settings').update({ default_sector_id: id }).eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}
