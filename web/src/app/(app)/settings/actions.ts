'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { createCompanyUser } from '@/lib/company-users';
import { friendlyDbError } from '@/lib/db-errors';
import { MENU_ITEMS } from '@/lib/menu';
import { normalizeShortcut, type QuickReply } from '@/lib/quick-replies';
import { recalcCompanyGroups, type RecalcSummary } from '@/lib/recalc-groups';
import { reapplyIgnoreRules, type ReapplySummary } from '@/lib/reapply-ignore';
import { createClient } from '@/lib/supabase/server';

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

/** Botão "Recalcular grupos" (Configurações › Equipe). */
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
  role: 'agent' | 'viewer' | 'admin';
  password: string;
}): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { data: member } = await supabase.from('team_members').select('id, name').eq('id', values.memberId).maybeSingle();
  if (!member) return { ok: false, error: 'Pessoa da equipe não encontrada.' };
  const email = values.email.trim().toLowerCase();
  const role = values.role === 'admin' || values.role === 'viewer' ? values.role : 'agent';
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
  revalidatePath('/settings/team');
  revalidatePath('/settings/users');
  return result(error);
}

export async function removeTeamMember(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  revalidatePath('/settings/team');
  return result(error);
}

/** Avisos da pessoa da equipe: só dos grupos em que ela é responsável (true) ou de todos (false). */
export async function setMemberAlertsOwnGroups(id: string, only: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('team_members').update({ alerts_own_groups_only: only }).eq('id', id);
  revalidatePath('/settings/team');
  return result(error);
}

// --------------------------------------------------------------- Usuários
export async function addAllowedEmail(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const raw = form.get('role');
  const role = raw === 'admin' || raw === 'viewer' ? raw : 'agent';
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

export async function updateUser(id: string, values: { role?: 'admin' | 'agent' | 'viewer'; active?: boolean }): Promise<Result> {
  const admin = await requireAdmin();
  if (id === admin.id) return { ok: false, error: 'Você não pode alterar o seu próprio acesso.' };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update(values).eq('id', id);
  if (!error && values.role) {
    const { data } = await supabase.from('profiles').select('email').eq('id', id).single();
    if (data) await supabase.from('allowed_emails').upsert({ email: data.email, role: values.role, company_id: admin.company_id });
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

export async function createSector(values: SectorInput): Promise<Result> {
  await requireAdmin();
  const row = cleanSector(values);
  if (!row.name) return { ok: false, error: 'Informe o nome do setor.' };
  const supabase = await createClient();
  const { error } = await supabase.from('sectors').insert(row);
  revalidatePath('/', 'layout');
  return result(error?.code === '23505' ? { message: 'Já existe um setor com esse nome.' } : error);
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
