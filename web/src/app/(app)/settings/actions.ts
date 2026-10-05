'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const result = (error: { message: string } | null | undefined): Result =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const intOrNull = (value: FormDataEntryValue | null) => {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// --------------------------------------------------------------- Geral
export async function saveGeneralSettings(form: FormData): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      company_name: String(form.get('company_name') || 'Minha Empresa'),
      timezone: String(form.get('timezone') || 'America/Sao_Paulo'),
      business_days: form.getAll('business_days').map(Number),
      business_start: String(form.get('business_start') || '08:00'),
      business_end: String(form.get('business_end') || '18:00'),
      auto_monitor_new_groups: form.get('auto_monitor_new_groups') === 'on',
      ignore_acknowledgements: form.get('ignore_acknowledgements') === 'on',
      history_import_days: [0, 7, 30, 60, 90].includes(Number(form.get('history_import_days')))
        ? Number(form.get('history_import_days'))
        : 30,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  revalidatePath('/', 'layout');
  return result(error);
}

// --------------------------------------------------------------- WhatsApp
export async function createInstance(name: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('whatsapp_instances')
    .insert({ name: name.trim() || 'WhatsApp', requested_action: 'connect', status: 'connecting' });
  revalidatePath('/settings/whatsapp');
  return result(error);
}

export async function requestInstanceAction(id: string, action: 'connect' | 'logout' | 'reimport'): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('whatsapp_instances')
    .update({
      requested_action: action,
      ...(action !== 'logout' ? { status: 'connecting', last_error: null } : {}),
    })
    .eq('id', id);
  revalidatePath('/settings/whatsapp');
  return result(error);
}

export async function deleteInstance(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('whatsapp_instances').delete().eq('id', id);
  revalidatePath('/', 'layout');
  return result(error);
}

// --------------------------------------------------------------- Regras de alerta
export async function saveAlertRule(form: FormData): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const id = String(form.get('id') || '');
  const type = String(form.get('type'));
  const groupIds = form.getAll('group_ids').map(String).filter(Boolean);

  const values = {
    name: String(form.get('name') || 'Regra sem nome'),
    type,
    severity: String(form.get('severity') || 'warning'),
    active: form.get('active') === 'on',
    threshold_minutes: intOrNull(form.get('threshold_minutes')),
    threshold_count: intOrNull(form.get('threshold_count')),
    keywords: type === 'keyword' ? list(form.get('keywords')) : null,
    group_ids: groupIds.length ? groupIds : null,
    business_hours_only: form.get('business_hours_only') === 'on',
    cooldown_minutes: intOrNull(form.get('cooldown_minutes')) ?? 60,
    notify_in_app: true,
    notify_emails: list(form.get('notify_emails')).map((e) => e.toLowerCase()),
    notify_whatsapp: list(form.get('notify_whatsapp')).map((p) => p.replace(/\D/g, '')).filter(Boolean),
    notify_webhook_url: String(form.get('notify_webhook_url') || '').trim() || null,
    updated_at: new Date().toISOString(),
  };

  if ((type === 'no_response' || type === 'inactivity' || type === 'high_volume') && !values.threshold_minutes) {
    return { ok: false, error: 'Informe o tempo (minutos) da regra.' };
  }
  if (type === 'high_volume' && !values.threshold_count) {
    return { ok: false, error: 'Informe a quantidade de mensagens.' };
  }
  if (type === 'keyword' && !values.keywords?.length) {
    return { ok: false, error: 'Informe ao menos uma palavra-chave.' };
  }

  const { error } = id
    ? await supabase.from('alert_rules').update(values).eq('id', id)
    : await supabase.from('alert_rules').insert(values);
  revalidatePath('/settings/alerts');
  return result(error);
}

export async function toggleAlertRule(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('alert_rules').update({ active }).eq('id', id);
  revalidatePath('/settings/alerts');
  return result(error);
}

export async function deleteAlertRule(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('alert_rules').delete().eq('id', id);
  revalidatePath('/settings/alerts');
  return result(error);
}

// --------------------------------------------------------------- Equipe
export async function addTeamMember(form: FormData): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const phone = String(form.get('phone') ?? '').replace(/\D/g, '');
  if (!phone) return { ok: false, error: 'Informe o telefone com DDI e DDD (ex.: 5511999998888).' };
  const { error } = await supabase.from('team_members').insert({ name: String(form.get('name') || phone), phone });
  revalidatePath('/settings/team');
  return result(error);
}

export async function removeTeamMember(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  revalidatePath('/settings/team');
  return result(error);
}

// --------------------------------------------------------------- Usuários
export async function addAllowedEmail(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const role = form.get('role') === 'admin' ? 'admin' : 'agent';
  const password = String(form.get('password') ?? '');
  const name = String(form.get('full_name') ?? '').trim();
  if (!email) return { ok: false, error: 'Informe o e-mail.' };

  const { error } = await supabase.from('allowed_emails').upsert({ email, role, created_by: admin.id });
  if (error) return result(error);

  // Com senha: cria o usuário já confirmado (login por e-mail e senha).
  // Sem senha: a pessoa entra com o Google usando este e-mail.
  if (password) {
    if (password.length < 8) return { ok: false, error: 'A senha deve ter ao menos 8 caracteres.' };
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, error: 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para criar usuários com senha.' };
    }
    const { error: createError } = await createAdminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : undefined,
    });
    if (createError) return result(createError);
  }
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function removeAllowedEmail(email: string): Promise<Result> {
  const admin = await requireAdmin();
  if (email === admin.email) return { ok: false, error: 'Você não pode remover o seu próprio acesso.' };
  const supabase = await createClient();
  const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
  if (!error) await supabase.from('profiles').update({ active: false }).eq('email', email);
  revalidatePath('/settings/users');
  return result(error);
}

export async function updateUser(id: string, values: { role?: 'admin' | 'agent'; active?: boolean }): Promise<Result> {
  const admin = await requireAdmin();
  if (id === admin.id) return { ok: false, error: 'Você não pode alterar o seu próprio acesso.' };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(values).eq('id', id);
  if (!error && values.role) {
    const { data } = await supabase.from('profiles').select('email').eq('id', id).single();
    if (data) await supabase.from('allowed_emails').upsert({ email: data.email, role: values.role });
  }
  revalidatePath('/settings/users');
  return result(error);
}

// --------------------------------------------------------------- Indicadores (somente admin)
export async function updateIndicator(
  key: string,
  changes: { enabled?: boolean; alert_enabled?: boolean; params?: Record<string, unknown> },
): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_indicator', {
    p_key: key,
    p_enabled: changes.enabled ?? null,
    p_alert_enabled: changes.alert_enabled ?? null,
    p_params: changes.params ?? null,
  });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function setIndicatorBlockEnabled(block: string, enabled: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_indicator_block_enabled', { p_block: block, p_enabled: enabled });
  revalidatePath('/', 'layout');
  return result(error);
}

export async function resetIndicators(key: string | null): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_indicators', { p_key: key });
  revalidatePath('/', 'layout');
  return result(error);
}

// --------------------------------------------------------------- Feriados (somente admin)
export async function addHoliday(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const day = String(form.get('day') ?? '');
  const name = String(form.get('name') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) return { ok: false, error: 'Informe a data e o nome do feriado.' };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').upsert({ day, name, created_by: admin.id });
  revalidatePath('/settings');
  return result(error);
}

export async function removeHoliday(day: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').delete().eq('day', day);
  revalidatePath('/settings');
  return result(error);
}

/** Horário comercial editado a partir do indicador (mesmo cadastro de Configurações › Geral). */
export async function saveBusinessHours(values: { days: number[]; start: string; end: string }): Promise<Result> {
  await requireAdmin();
  if (!/^\d{2}:\d{2}/.test(values.start) || !/^\d{2}:\d{2}/.test(values.end)) {
    return { ok: false, error: 'Informe o início e o fim do expediente.' };
  }
  if (values.start >= values.end) return { ok: false, error: 'O fim do expediente deve ser depois do início.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      business_days: values.days.filter((d) => d >= 0 && d <= 6),
      business_start: values.start,
      business_end: values.end,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function saveReplySettings(values: {
  enabled: boolean;
  signName: boolean;
  allowed: 'all' | 'admin';
}): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      reply_enabled: values.enabled,
      reply_sign_name: values.signName,
      reply_allowed: values.allowed === 'admin' ? 'admin' : 'all',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  revalidatePath('/', 'layout');
  return result(error);
}
