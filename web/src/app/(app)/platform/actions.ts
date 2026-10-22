'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '@/lib/auth';
import { createCompanyUser } from '@/lib/company-users';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const limit = (form: FormData, key: string) => {
  const n = Number.parseInt(text(form, key), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Cadastra a empresa (já com configurações, setor "Geral" e regras de alerta) e o primeiro administrador dela. */
export async function createCompany(form: FormData): Promise<Result> {
  const me = await requirePlatformAdmin();
  const name = text(form, 'name');
  const adminEmail = text(form, 'admin_email').toLowerCase();
  const adminPassword = text(form, 'admin_password');
  if (!name) return { ok: false, error: 'Informe o nome da empresa.' };
  if (!adminEmail) return { ok: false, error: 'Informe o e-mail do administrador da empresa.' };
  if (adminPassword.length < 8) return { ok: false, error: 'A senha inicial do administrador precisa de ao menos 8 caracteres.' };

  const supabase = await createClient();
  const { data: companyId, error } = await supabase.rpc('create_company', {
    p_name: name,
    p_document: text(form, 'document') || null,
    p_contact_name: text(form, 'contact_name') || null,
    p_contact_email: text(form, 'contact_email') || adminEmail,
    p_contact_phone: text(form, 'contact_phone') || null,
    p_max_groups: limit(form, 'max_groups'),
    p_max_users: limit(form, 'max_users'),
    p_notes: text(form, 'notes') || null,
  });
  if (error || !companyId) return { ok: false, error: friendlyDbError(error?.message ?? 'Não foi possível cadastrar a empresa.') };

  const user = await createCompanyUser({
    companyId: companyId as string,
    email: adminEmail,
    password: adminPassword,
    role: 'admin',
    name: text(form, 'admin_name') || undefined,
    createdBy: me.id,
  });
  revalidatePath('/platform');
  if (!user.ok) {
    return { ok: false, error: `Empresa cadastrada, mas o administrador não foi criado: ${user.error} Adicione-o no cartão da empresa.` };
  }
  return { ok: true };
}

/** Altera dados, limites ou a situação (ativa/suspensa) da empresa. */
export async function updateCompany(id: string, changes: Record<string, unknown>): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_company', { p_id: id, p_changes: changes });
  revalidatePath('/platform');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Liga/desliga as conversas privadas (0069) de uma empresa. */
export async function setCompanyPrivateChats(id: string, enabled: boolean): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_company_private_chats', { p_company_id: id, p_enabled: enabled });
  revalidatePath('/', 'layout');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

export async function saveCompany(id: string, form: FormData): Promise<Result> {
  return updateCompany(id, {
    name: text(form, 'name'),
    document: text(form, 'document'),
    contact_name: text(form, 'contact_name'),
    contact_email: text(form, 'contact_email'),
    contact_phone: text(form, 'contact_phone'),
    max_groups: text(form, 'max_groups'),
    max_users: text(form, 'max_users'),
    notes: text(form, 'notes'),
  });
}

/** Libera mais um administrador para a empresa (e-mail + senha inicial). */
export async function addCompanyAdmin(companyId: string, form: FormData): Promise<Result> {
  const me = await requirePlatformAdmin();
  const res = await createCompanyUser({
    companyId,
    email: text(form, 'email'),
    password: text(form, 'password'),
    role: 'admin',
    name: text(form, 'name') || undefined,
    createdBy: me.id,
  });
  revalidatePath('/platform');
  return res.ok ? res : { ok: false, error: friendlyDbError(res.error) };
}

/** Entra na empresa para configurar ou dar suporte (o painel passa a mostrar os dados dela). */
export async function switchCompany(id: string, to = '/dashboard'): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('switch_company', { p_company_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/', 'layout');
  redirect(to);
}
