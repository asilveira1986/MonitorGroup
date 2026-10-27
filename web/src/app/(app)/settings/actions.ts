'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { createCompanyUser } from '@/lib/company-users';
import { friendlyDbError } from '@/lib/db-errors';
import { MENU_ITEMS } from '@/lib/menu';
import { normalizeShortcut, type QuickReply } from '@/lib/quick-replies';
import { recalcCompanyGroups, type RecalcSummary } from '@/lib/recalc-groups';
import { reapplyIgnoreRules, type ReapplySummary } from '@/lib/reapply-ignore';
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
      history_import_days: [0, 7, 30, 60, 90].includes(Number(form.get('history_import_days')))
        ? Number(form.get('history_import_days'))
        : 30,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
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
/** Indicador que cada tipo de regra segue: com ele (ou o alerta dele) desligado, a regra não dispara. */
const RULE_INDICATOR: Record<string, string | null> = {
  no_response: 'mensagens_pendentes',
  high_volume: 'volume_por_grupo',
  inactivity: 'grupos_silenciosos',
  keyword: 'cobrancas_reclamacoes',
  deadline_missed: 'prazo_prometido_cumprido',
  rework: 'retrabalho',
  recurrence: 'reincidencia_sem_resposta',
  disconnected: null,
};

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
    // reincidência: a tela pede a janela em dias
    threshold_minutes:
      type === 'recurrence'
        ? (intOrNull(form.get('threshold_days')) ?? 0) * 1440 || null
        : intOrNull(form.get('threshold_minutes')),
    threshold_count: intOrNull(form.get('threshold_count')),
    keywords: type === 'keyword' ? list(form.get('keywords')) : null,
    group_ids: groupIds.length ? groupIds : null,
    business_hours_only: form.get('business_hours_only') === 'on',
    voice: form.get('voice') === 'on',
    cooldown_minutes: intOrNull(form.get('cooldown_minutes')) ?? (type === 'recurrence' ? 1440 : 60),
    notify_in_app: true,
    notify_emails: list(form.get('notify_emails')).map((e) => e.toLowerCase()),
    notify_whatsapp: list(form.get('notify_whatsapp')).map((p) => p.replace(/\D/g, '')).filter(Boolean),
    notify_webhook_url: String(form.get('notify_webhook_url') || '').trim() || null,
    notify_responsibles: form.get('notify_responsibles') === 'on',
    indicator_key: RULE_INDICATOR[type] ?? null,
    updated_at: new Date().toISOString(),
  };

  if (type === 'recurrence' && (!values.threshold_count || !values.threshold_minutes)) {
    return { ok: false, error: 'Informe a quantidade de falhas e em quantos dias.' };
  }
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
  const profile = await requireProfile();
  const supabase = await createClient();
  const phone = String(form.get('phone') ?? '').replace(/\D/g, '');
  if (!phone) return { ok: false, error: 'Informe o telefone com DDI e DDD (ex.: 5511999998888).' };
  const { error } = await supabase.from('team_members').insert({ name: String(form.get('name') || phone), phone });
  // mensagens antigas da pessoa passam a contar como da equipe
  if (!error) await recalcCompanyGroups(profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/** Mensagens a ignorar: agradecimentos, figurinha/emoji e frases da empresa. */
export async function saveIgnoreSettings(values: {
  acknowledgements: boolean;
  stickers: boolean;
  phrases: string[];
  /** reação da equipe conta como resposta (0111) */
  reactions?: boolean;
}): Promise<Result & { summary?: ReapplySummary }> {
  const profile = await requireAdmin();
  const phrases = [...new Set(values.phrases.map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean))]
    .map((p) => p.slice(0, 120))
    .slice(0, 200);
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      ignore_acknowledgements: values.acknowledgements,
      ignore_stickers_emoji: values.stickers,
      ignore_phrases: phrases,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  if (error) return result(error);
  // à parte: sem o script 0111 a coluna não existe e o resto salva normal
  if (values.reactions !== undefined) {
    await supabase.from('app_settings').update({ reaction_answers: values.reactions }).eq('company_id', profile.company_id);
  }
  // as mensagens já recebidas passam pelas mesmas regras
  let summary: ReapplySummary | undefined;
  try {
    if (profile.company_id) summary = await reapplyIgnoreRules(profile.company_id, {
      acknowledgements: values.acknowledgements,
      stickers: values.stickers,
      phrases,
    });
  } catch (err) {
    revalidatePath('/', 'layout');
    return { ok: false, error: `Regras salvas, mas não foi possível atualizar as mensagens já recebidas: ${(err as Error).message}` };
  }
  revalidatePath('/', 'layout');
  return { ok: true, summary };
}

// --------------------------------------------------------------- Mensagens rápidas
export async function saveQuickReply(values: {
  id: string | null;
  shortcut: string;
  title: string;
  body: string;
}): Promise<Result & { item?: QuickReply }> {
  await requireAdmin();
  const shortcut = normalizeShortcut(values.shortcut);
  const body = values.body.trim();
  if (!shortcut) return { ok: false, error: 'Informe o atalho (letras, números, - ou _).' };
  if (!body) return { ok: false, error: 'Escreva o texto da mensagem.' };
  const row = { shortcut, title: values.title.trim() || null, body: body.slice(0, 4000), updated_at: new Date().toISOString() };
  const supabase = await createClient();
  const query = values.id
    ? supabase.from('quick_replies').update(row).eq('id', values.id)
    : supabase.from('quick_replies').insert(row);
  const { data, error } = await query.select('id, shortcut, title, body').single();
  if (error?.code === '23505') return { ok: false, error: `Já existe uma mensagem rápida com o atalho \\${shortcut}.` };
  if (error) return result(error);
  revalidatePath('/settings/quick-replies');
  revalidatePath('/groups', 'layout');
  return { ok: true, item: data as QuickReply };
}

/** Qual mensagem rápida encerra a conversa (padrão \fechamento). */
export async function saveClosingShortcut(shortcut: string): Promise<Result> {
  const profile = await requireAdmin();
  const value = normalizeShortcut(shortcut);
  if (!value) return { ok: false, error: 'Escolha a mensagem rápida de fechamento.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ closing_shortcut: value, updated_at: new Date().toISOString() })
    .eq('company_id', profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function deleteQuickReply(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('quick_replies').delete().eq('id', id);
  revalidatePath('/settings/quick-replies');
  return result(error);
}

/** Botão "Recalcular grupos" (Configurações › Atendentes). */
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

// --------------------------------------------------------------- Usuários
export async function addAllowedEmail(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const raw = form.get('role');
  const role = raw === 'admin' || raw === 'viewer' || raw === 'agenda' ? raw : 'agent';
  const password = String(form.get('password') ?? '');
  const name = String(form.get('full_name') ?? '').trim();
  // o acesso é só por e-mail e senha: a senha inicial é obrigatória; o usuário fica na empresa de quem cadastra
  const res = await createCompanyUser({
    companyId: admin.company_id!,
    email,
    password,
    role,
    name,
    createdBy: admin.id,
  });
  if (!res.ok) return { ok: false, error: friendlyDbError(res.error) };
  revalidatePath('/settings/people');
  return { ok: true };
}

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

// --------------------------------------------------------------- Tipos de demanda (somente admin)
/** Salva os tipos de demanda (categorias do indicador "Tipo de demanda") e renomeia nas demandas. */
export async function saveDemandTypes(
  types: { name: string; keywords: string[] }[],
  renames: { from: string; to: string }[],
): Promise<Result & { renamed?: number }> {
  await requireAdmin();
  const clean = types
    .map((t) => ({
      name: t.name.trim().replace(/\s+/g, ' ').slice(0, 60),
      keywords: [...new Set(t.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 100),
    }))
    .filter((t) => t.name);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_indicator', {
    p_key: 'tipo_demanda',
    p_enabled: null,
    p_alert_enabled: null,
    p_params: { categories: clean },
  });
  if (error) return result(error);
  let renamed = 0;
  for (const r of renames) {
    const { data, error: e } = await supabase.rpc('rename_demand_type', { p_old: r.from, p_new: r.to });
    if (e) return result(e);
    renamed += Number(data ?? 0);
  }
  revalidatePath('/', 'layout');
  return { ok: true, renamed };
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
  const { error } = await supabase
    .from('holidays')
    .upsert({ company_id: admin.company_id, day, name, created_by: admin.id }, { onConflict: 'company_id,day' });
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

/** Horário comercial editado a partir do indicador (mesmo cadastro de Configurações › Empresa). */
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
    .eq('company_id', (await requireAdmin()).company_id);
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
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function saveMediaSettings(values: { enabled: boolean; types: string[]; days: number; avatars: boolean }): Promise<Result> {
  const profile = await requireAdmin();
  const allowed = ['image', 'audio', 'sticker', 'video', 'document'];
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      media_store_enabled: values.enabled,
      media_store_types: allowed.filter((t) => values.types.includes(t)),
      media_retention_days: [30, 60, 90, 180, 365, 0].includes(values.days) ? values.days : 90,
      avatars_enabled: values.avatars,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function saveMessageAlertSettings(values: {
  enabled: boolean;
  alerts: boolean;
  autoClose: number;
  sound: boolean;
}): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      msg_alert_enabled: values.enabled,
      msg_alert_auto_close: Math.max(0, Math.min(600, Math.round(values.autoClose))),
      msg_alert_sound: values.sound,
      msg_alert_alerts: values.alerts,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

// ---------------------------------------------------------------------
// Setores (somente admin): grupos e usuários de cada setor e as permissões
// ---------------------------------------------------------------------
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

// --------------------------------------------------------------- Menus do menu lateral
/** Quem vê cada item do menu lateral: todos, só administradores ou ninguém. */
export async function saveMenuAccess(access: Record<string, 'all' | 'admin' | 'none'>): Promise<Result> {
  const admin = await requireAdmin();
  const allowed = new Set(MENU_ITEMS.map((i) => i.href as string));
  const clean = Object.fromEntries(
    Object.entries(access).filter(
      ([href, v]) => allowed.has(href) && (v === 'admin' || v === 'none') && !(href === '/settings' && v === 'none'),
    ),
  );
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ menu_access: clean, updated_at: new Date().toISOString() })
    .eq('company_id', admin.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

// --------------------------------------------------------------- Aviso por voz (Regras de alerta)
export async function saveVoiceSettings(values: {
  voice: boolean;
  messages: boolean;
  sla: boolean;
  templates: Record<string, string | undefined>;
  voiceName: string | null;
  rate: number;
  pitch: number;
}): Promise<Result> {
  const admin = await requireAdmin();
  // só as frases conhecidas, sem espaços sobrando e com tamanho razoável (vazia = frase padrão)
  const templates = Object.fromEntries(
    (['message', 'sla', 'alert'] as const)
      .map((k) => [k, (values.templates[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)] as const)
      .filter(([, t]) => t),
  );
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number(n) || 1));
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      msg_alert_voice: values.voice,
      msg_alert_voice_messages: values.messages,
      msg_alert_voice_sla: values.sla,
      msg_alert_voice_templates: templates,
      msg_alert_voice_name: values.voiceName?.trim() || null,
      msg_alert_voice_rate: Math.round(clamp(values.rate, 0.5, 2) * 10) / 10,
      msg_alert_voice_pitch: Math.round(clamp(values.pitch, 0, 2) * 10) / 10,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', admin.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

const IMAGE_MAX = 2 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

/**
 * Logo da empresa ou foto do atendente (0083): devolve um link de upload direto para o Storage
 * (bucket privado, pasta da empresa); o arquivo não passa pelo servidor do painel.
 */
export async function prepareImageUpload(
  kind: 'logo' | 'team',
  file: { mime: string; size: number },
): Promise<{ ok: true; data: { path: string; token: string } } | { ok: false; error: string }> {
  const profile = kind === 'logo' ? await requireAdmin() : await requireProfile();
  const ext = IMAGE_TYPES[file.mime];
  if (!ext) return { ok: false, error: 'Envie uma imagem PNG, JPG, WEBP, SVG ou GIF.' };
  if (file.size > IMAGE_MAX) return { ok: false, error: 'A imagem passa de 2 MB.' };
  if (!profile.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  const path = `${profile.company_id}/${kind === 'logo' ? 'branding' : 'team'}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio da imagem.' };
  return { ok: true, data: { path, token: data.token } };
}

/** Grava (ou tira, com null) o logo da empresa. */
export async function saveCompanyLogo(path: string | null): Promise<Result> {
  await requireAdmin();
  const { error } = await (await createClient()).rpc('set_company_logo', { p_path: path });
  revalidatePath('/', 'layout');
  return result(error);
}

/** Grava (ou tira, com null) a foto do atendente. */
export async function saveTeamPhoto(memberId: string, path: string | null): Promise<Result> {
  await requireProfile();
  const { error } = await (await createClient()).rpc('set_team_member_photo', { p_member_id: memberId, p_path: path });
  revalidatePath('/settings/people');
  return result(error);
}

// ---------------------------------------------------------------- Pessoas (0107)
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
export async function updatePerson(values: { profileId: string | null; memberId: string | null; name: string; phone: string }): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const name = values.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Informe o nome.' };
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
