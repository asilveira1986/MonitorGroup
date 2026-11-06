'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export async function removeAllowedEmail(email: string): Promise<Result> {
  const admin = await requireAdmin();
  if (email === admin.email) return { ok: false, error: 'Você não pode remover o seu próprio acesso.' };
  const supabase = await createClient();
  const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
  if (!error) await supabase.from('profiles').update({ active: false }).eq('email', email);
  revalidatePath('/settings/people');
  return result(error);
}

/**
 * Administrador: gera uma senha nova para o usuário e devolve para mostrar uma única vez (a senha não fica
 * guardada em lugar nenhum legível; o Supabase guarda só o hash). Só usuários da mesma empresa; a senha de
 * quem administra a plataforma só ele mesmo (ou outro administrador da plataforma) gera.
 */
export async function generateUserPassword(id: string): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const me = await requireAdmin();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para gerar senhas.' };
  }
  const admin = createAdminClient();
  const { data: user } = await admin.from('profiles').select('id, email, full_name, company_id, platform_admin').eq('id', id).maybeSingle();
  if (!user || (!me.platform_admin && user.company_id !== me.company_id)) return { ok: false, error: 'Usuário não encontrado.' };
  if (user.platform_admin && !me.platform_admin) {
    return { ok: false, error: 'A senha de quem administra a plataforma só ele mesmo pode trocar.' };
  }
  // 10 caracteres sem os que se confundem (0/O, 1/l/I), com letra maiúscula, minúscula e número
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 7 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join('');
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  // a senha gerada é provisória: no próximo acesso a pessoa define a dela (0123)
  await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
  // registro no log (sem a senha)
  await admin.from('activity_log').insert({
    company_id: user.company_id ?? me.company_id,
    user_id: me.id,
    user_email: me.email,
    user_name: me.full_name || me.email,
    category: 'usuarios',
    action: 'gerou senha',
    entity: 'profiles',
    entity_id: id,
    summary: `Gerou uma senha nova para ${user.full_name ? `${user.full_name} (${user.email})` : user.email}`,
  });
  return { ok: true, password };
}

/**
 * Quem administra a plataforma: exclui o usuário de vez (login, perfil e autorização do e-mail).
 * O histórico fica (demandas, alertas e log guardam o nome); a pessoa da equipe ligada perde o acesso.
 */
export async function deleteUser(id: string): Promise<Result> {
  const me = await requireProfile();
  if (!me.platform_admin) return { ok: false, error: 'Somente quem administra a plataforma exclui usuários.' };
  if (id === me.id) return { ok: false, error: 'Você não pode excluir o seu próprio usuário.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para excluir usuários.' };
  }
  const admin = createAdminClient();
  const { data: user } = await admin.from('profiles').select('id, email, full_name, company_id').eq('id', id).maybeSingle();
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };
  await admin.from('allowed_emails').delete().eq('email', user.email);
  // e-mail exato, sem diferenciar maiúsculas ("_" e "%" escapados: no ilike seriam curingas e
  // atingiriam outros cadastros)
  await admin.from('team_members').update({ user_email: null }).ilike('user_email', user.email.replace(/[\\%_]/g, (c: string) => `\\${c}`));
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  await admin.from('activity_log').insert({
    company_id: user.company_id ?? me.company_id,
    user_id: me.id,
    user_email: me.email,
    user_name: me.full_name || me.email,
    category: 'usuarios',
    action: 'excluiu',
    entity: 'profiles',
    entity_id: id,
    summary: `Excluiu o usuário ${user.full_name ? `${user.full_name} (${user.email})` : user.email}`,
  });
  revalidatePath('/settings/people');
  return { ok: true };
}

export async function updateUser(id: string, values: { role?: 'admin' | 'agent' | 'viewer' | 'agenda'; active?: boolean }): Promise<Result> {
  const admin = await requireAdmin();
  if (id === admin.id) return { ok: false, error: 'Você não pode alterar o seu próprio acesso.' };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(values).eq('id', id);
  if (!error && values.role) {
    const { data } = await supabase.from('profiles').select('email').eq('id', id).single();
    if (data) await supabase.from('allowed_emails').upsert({ email: data.email, role: values.role, company_id: admin.company_id });
  }
  revalidatePath('/settings/people');
  return result(error);
}
