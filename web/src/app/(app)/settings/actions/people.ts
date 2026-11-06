'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createCompanyUser } from '@/lib/company-users';
import { friendlyDbError } from '@/lib/db-errors';
import { recalcCompanyGroups, type RecalcSummary } from '@/lib/recalc-groups';
import { createAdminClient, createClient } from '@/lib/supabase/server';

/**
 * Botão "Recalcular grupos", em etapas curtas (0132): com muitas mensagens, numa operação só passava do
 * limite de tempo do Supabase. 1) separa equipe x cliente e devolve os grupos; 2) a tela manda os grupos
 * em lotes; 3) resolve os alertas e registra no log. Roda com a chave de serviço, depois de conferir que
 * quem pede administra a empresa.
 */
export async function recalcGroupsStart(): Promise<
  { ok: true; ids: string[]; reclass: number; unmark: number; before: number } | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  const db = createAdminClient();
  const { data, error } = await db.rpc('recalc_company_reclassify', { p_company_id: admin.company_id });
  if (error) return { ok: false, error: /recalc_company_reclassify/.test(error.message) ? 'Rode o atualizar_banco no Supabase (script 0132).' : friendlyDbError(error.message) };
  const { data: groups } = await db.from('groups').select('id').eq('company_id', admin.company_id);
  const r = data as { reclass: number; unmark: number; before: number };
  return { ok: true, ids: ((groups ?? []) as { id: string }[]).map((g) => g.id), reclass: r.reclass, unmark: r.unmark, before: r.before };
}

export async function recalcGroupsBatch(ids: string[]): Promise<Result & { done?: number }> {
  const admin = await requireAdmin();
  const { data, error } = await createAdminClient().rpc('recalc_company_rebuild', { p_company_id: admin.company_id, p_ids: ids.slice(0, 100) });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, done: data as number };
}

export async function recalcGroupsFinish(partial: { reclass: number; unmark: number; before: number; groups: number }): Promise<Result & { summary?: RecalcSummary }> {
  const admin = await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db.rpc('recalc_company_finish', { p_company_id: admin.company_id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  const f = data as { after: number; alerts: number };
  const summary: RecalcSummary = {
    mensagens_reclassificadas: partial.reclass + partial.unmark,
    mensagens_da_equipe: partial.reclass,
    mensagens_de_cliente: partial.unmark,
    grupos_recalculados: partial.groups,
    aguardando_antes: partial.before,
    aguardando_depois: f.after,
    alertas_resolvidos: f.alerts,
  };
  await db.from('activity_log').insert({
    company_id: admin.company_id,
    user_id: admin.id,
    user_email: admin.email,
    user_name: admin.full_name || admin.email,
    category: 'equipe',
    action: 'recalculou',
    entity: 'groups',
    summary: `Recalculou os grupos (aguardando: ${summary.aguardando_antes} → ${summary.aguardando_depois})`,
    details: summary,
  });
  revalidatePath('/', 'layout');
  return { ok: true, summary };
}

/** Recalcular numa operação só (banco sem o script 0132). */
export async function recalcGroups(): Promise<Result & { summary?: RecalcSummary }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recalc_groups');
  revalidatePath('/', 'layout');
  if (error) return result(error);
  return { ok: true, summary: data as RecalcSummary };
}

/** Administrador: cria o usuário do sistema para uma pessoa da equipe (nome dela, e-mail e senha inicial). */
export async function grantTeamMemberAccess(values: {
  memberId: string;
  email: string;
  role: 'agent' | 'viewer' | 'admin' | 'agenda';
  password: string;
}): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data: member } = await supabase.from('team_members').select('id, name').eq('id', values.memberId).maybeSingle();
  if (!member) return { ok: false, error: 'Pessoa da equipe não encontrada.' };
  const email = values.email.trim().toLowerCase();
  const role = values.role === 'admin' || values.role === 'viewer' || values.role === 'agenda' ? values.role : 'agent';
  const res = await createCompanyUser({
    companyId: admin.company_id!,
    email,
    password: values.password,
    role,
    name: member.name,
    createdBy: admin.id,
  });
  if (!res.ok) return { ok: false, error: friendlyDbError(res.error) };
  const { error } = await supabase.from('team_members').update({ user_email: email }).eq('id', member.id);
  revalidatePath('/settings/people');
  return result(error);
}

export async function removeTeamMember(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  revalidatePath('/settings/people');
  return result(error);
}

/** Avisos da pessoa da equipe: só dos grupos em que ela é responsável (true) ou de todos (false). */
export async function setMemberAlertsOwnGroups(id: string, only: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('team_members').update({ alerts_own_groups_only: only }).eq('id', id);
  revalidatePath('/settings/people');
  return result(error);
}

/** telefone só com dígitos e com 55 no Brasil (DDD + número) */
const brPhone = (raw: string | null | undefined) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
};

const revalidatePeople = () => {
  revalidatePath('/settings/people');
  revalidatePath('/', 'layout');
};

/**
 * Troca o e-mail de acesso de um usuário em todos os lugares: o login (Supabase Auth, já confirmado), o
 * perfil, a autorização de acesso e o atendente ligado pelo e-mail. A senha continua a mesma.
 * Devolve a mensagem de erro, ou null.
 */
async function changeUserEmail(me: Awaited<ReturnType<typeof requireAdmin>>, userId: string, rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'E-mail inválido.';
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para trocar o e-mail.';
  const admin = createAdminClient();
  const { data: user } = await admin.from('profiles').select('id, email, full_name, company_id, platform_admin').eq('id', userId).maybeSingle();
  if (!user || (!me.platform_admin && user.company_id !== me.company_id)) return 'Usuário não encontrado.';
  const old = String(user.email ?? '').toLowerCase();
  if (email === old) return null;
  if (user.platform_admin && !me.platform_admin) return 'O e-mail de quem administra a plataforma só ele mesmo pode trocar.';
  const { data: taken } = await admin.from('profiles').select('id').ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`)).neq('id', userId).limit(1);
  if (taken?.length) return 'Este e-mail já é de outro usuário.';
  const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
  if (error) return /already|registered|exists/i.test(error.message) ? 'Este e-mail já é de outro usuário.' : friendlyDbError(error.message);
  await admin.from('profiles').update({ email }).eq('id', userId);
  // autorização de acesso: a do e-mail antigo passa para o novo (se o novo já tinha uma, fica a nova)
  const { data: newAllowed } = await admin.from('allowed_emails').select('email').eq('email', email).maybeSingle();
  if (newAllowed) await admin.from('allowed_emails').delete().eq('email', old);
  else await admin.from('allowed_emails').update({ email }).eq('email', old);
  // atendente ligado pelo e-mail (e-mail exato, sem diferenciar maiúsculas)
  if (user.company_id) {
    await admin
      .from('team_members')
      .update({ user_email: email })
      .eq('company_id', user.company_id)
      .ilike('user_email', old.replace(/[\\%_]/g, (c) => `\\${c}`));
  }
  await admin.from('activity_log').insert({
    company_id: user.company_id ?? me.company_id,
    user_id: me.id,
    user_email: me.email,
    user_name: me.full_name || me.email,
    category: 'usuarios',
    action: 'trocou e-mail',
    entity: 'profiles',
    entity_id: userId,
    summary: `Trocou o e-mail de ${user.full_name || old} de ${old} para ${email}`,
  });
  return null;
}

/** Setores do usuário (quem vê e atende os grupos de cada setor): deixa exatamente os escolhidos. */
async function syncUserSectors(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, sectorIds: string[]): Promise<string | null> {
  const ids = [...new Set(sectorIds.filter(Boolean))];
  const del = supabase.from('sector_members').delete().eq('user_id', userId);
  const { error: delError } = ids.length ? await del.not('sector_id', 'in', `(${ids.join(',')})`) : await del;
  if (delError) return delError.message;
  if (ids.length) {
    const { error } = await supabase
      .from('sector_members')
      .upsert(ids.map((sector_id) => ({ sector_id, user_id: userId })), { onConflict: 'sector_id,user_id', ignoreDuplicates: true });
    if (error) return error.message;
  }
  return null;
}

/**
 * Nova pessoa (0107): um cadastro só. "Atende nos grupos" cria o atendente (pelo telefone);
 * "entra no painel" cria o acesso (e-mail, perfil e senha). Os dois ficam ligados pelo e-mail.
 */
export async function addPerson(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
  const phone = brPhone(String(form.get('phone') ?? ''));
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const attends = form.get('attends') === 'on';
  const access = form.get('access') === 'on';
  const raw = form.get('role');
  const role = raw === 'admin' || raw === 'viewer' || raw === 'agenda' ? raw : 'agent';
  if (!name) return { ok: false, error: 'Informe o nome.' };
  if (!attends && !access) return { ok: false, error: 'Marque se a pessoa atende nos grupos, entra no painel, ou os dois.' };
  if (attends && !phone) return { ok: false, error: 'Para atender nos grupos, informe o WhatsApp da pessoa (com DDD).' };
  if (access && !email) return { ok: false, error: 'Para entrar no painel, informe o e-mail.' };

  if (access) {
    const res = await createCompanyUser({
      companyId: admin.company_id!,
      email,
      password: String(form.get('password') ?? ''),
      role,
      name,
      createdBy: admin.id,
    });
    if (!res.ok) return { ok: false, error: friendlyDbError(res.error) };
    if (phone) await createAdminClient().from('profiles').update({ phone }).eq('email', email).eq('company_id', admin.company_id!);
    // setores escolhidos no cadastro
    const sectorIds = form.getAll('sectors').map(String);
    if (sectorIds.length) {
      const { data: created } = await createAdminClient().from('profiles').select('id').eq('email', email).eq('company_id', admin.company_id!).maybeSingle();
      if (created?.id) {
        const err = await syncUserSectors(supabase, created.id as string, sectorIds);
        if (err) return { ok: false, error: `Pessoa cadastrada, mas os setores não foram salvos: ${friendlyDbError(err)}` };
      }
    }
  }
  if (attends) {
    const { error } = await supabase.from('team_members').insert({ name, phone, user_email: access ? email : null });
    if (error) {
      return {
        ok: false,
        error: /duplicate|unique/i.test(error.message) ? 'Já existe um atendente com esse telefone.' : friendlyDbError(error.message),
      };
    }
    // mensagens antigas da pessoa passam a contar como da equipe
    await recalcCompanyGroups(admin.company_id);
  }
  revalidatePeople();
  return { ok: true };
}

/** Editar nome e telefone: vale para o acesso e para o atendente da pessoa. */
export async function updatePerson(values: {
  profileId: string | null;
  memberId: string | null;
  name: string;
  phone: string;
  /** setores do usuário (só quem tem acesso ao painel); undefined = não mexe */
  sectorIds?: string[];
  /** novo e-mail de acesso; undefined (ou igual ao atual) = não mexe */
  email?: string;
}): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const name = values.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Informe o nome.' };
  if (values.profileId && values.email !== undefined) {
    const err = await changeUserEmail(admin, values.profileId, values.email);
    if (err) return { ok: false, error: err };
  }
  const phone = brPhone(values.phone);
  if (values.memberId) {
    // o atendente; o acesso ligado a ele acompanha (0107)
    const { error } = await supabase.from('team_members').update({ name, phone }).eq('id', values.memberId);
    if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'Já existe um atendente com esse telefone.' : friendlyDbError(error.message) };
  }
  if (values.profileId) {
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name, phone })
      .eq('id', values.profileId)
      .eq('company_id', admin.company_id!);
    if (error) return result(error);
    if (values.sectorIds) {
      const err = await syncUserSectors(supabase, values.profileId, values.sectorIds);
      if (err) return { ok: false, error: friendlyDbError(err) };
    }
  }
  if (values.memberId) await recalcCompanyGroups(admin.company_id);
  revalidatePeople();
  return { ok: true };
}

/** Quem só entra no painel passa a atender nos grupos (vira atendente, ligado pelo e-mail). */
export async function makeAttendant(profileId: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data: p } = await supabase.from('profiles').select('full_name, email, phone').eq('id', profileId).maybeSingle();
  if (!p) return { ok: false, error: 'Pessoa não encontrada.' };
  const { error } = await supabase
    .from('team_members')
    .insert({ name: (p.full_name as string) || (p.email as string).split('@')[0], phone: brPhone(p.phone as string | null), user_email: p.email });
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'Já existe um atendente com esse telefone.' : friendlyDbError(error.message) };
  await recalcCompanyGroups(admin.company_id);
  revalidatePeople();
  return { ok: true };
}
