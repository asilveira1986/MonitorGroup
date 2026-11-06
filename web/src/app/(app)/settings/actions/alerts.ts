'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const intOrNull = (value: FormDataEntryValue | null) => {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

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

/** Avisos em tela das conversas privadas (0120). */
export async function savePrivateAlertSettings(values: { mine: boolean; queue: boolean; sound: boolean; voice: boolean }): Promise<Result> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      private_alert_mine: values.mine,
      private_alert_queue: values.queue,
      private_alert_sound: values.sound,
      private_alert_voice: values.voice,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/**
 * Grupo de alertas fora do expediente (0139): o worker avisa nele quando o SLA de um grupo estoura
 * fora do horário de trabalho. `enabled` liga/desliga sem perder o grupo escolhido. `minutes`: minutos sem resposta para avisar (null: o SLA do grupo).
 */
export async function saveAfterHoursAlertGroup(groupId: string | null, minutes: number | null = null, enabled = true): Promise<Result> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  if (enabled && !groupId) return { ok: false, error: 'Escolha o grupo que recebe o aviso.' };
  if (groupId) {
    const { data: group } = await supabase.from('groups').select('id, removed_at').eq('id', groupId).maybeSingle();
    if (!group || group.removed_at) return { ok: false, error: 'Escolha um grupo em que o número conectado ainda participa.' };
  }
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
    return { ok: false, error: 'Informe os minutos sem resposta entre 1 e 1440 (ou deixe em branco para usar o SLA do grupo).' };
  }
  const { error } = await supabase
    .from('app_settings')
    .update({
      after_hours_alert_group_id: groupId,
      after_hours_alert_minutes: minutes,
      after_hours_alert_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  revalidatePath('/settings/alerts');
  return result(error);
}

/**
 * Mensagem de teste no grupo de alertas: entra na mesma fila de envio das respostas do painel e o worker
 * manda pelo número conectado. O resultado (enviada ou o motivo da falha) vem de `testAfterHoursAlertGroupStatus`.
 */
export async function testAfterHoursAlertGroup(): Promise<Result & { id?: string }> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('*').eq('company_id', profile.company_id).maybeSingle();
  const groupId = (settings as { after_hours_alert_group_id?: string | null } | null)?.after_hours_alert_group_id;
  if (!groupId) return { ok: false, error: 'Escolha o grupo de alertas e salve antes de testar.' };
  const { data: group } = await supabase.from('groups').select('id, name, instance_id, removed_at').eq('id', groupId).maybeSingle();
  if (!group || group.removed_at) return { ok: false, error: 'O número conectado não participa mais desse grupo. Escolha outro.' };
  const text = '✅ Teste do grupo de alertas fora do expediente: se você está lendo isto, os avisos de SLA vão chegar aqui.';
  const { data, error } = await createAdminClient()
    .from('outgoing_messages')
    .insert({
      group_id: group.id,
      instance_id: group.instance_id,
      body: text,
      text_to_send: text,
      sender_name: profile.full_name || 'Monitor Group',
      created_by: profile.id,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, id: data.id as string };
}

/** Situação da mensagem de teste: na fila, enviando, enviada ou o motivo da falha. */
export async function testAfterHoursAlertGroupStatus(
  id: string,
): Promise<{ ok: true; status: 'pending' | 'sending' | 'sent' | 'failed'; error: string | null } | { ok: false; error: string }> {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from('outgoing_messages').select('status, error, groups!inner(company_id)').eq('id', id).maybeSingle();
  const row = data as { status: 'pending' | 'sending' | 'sent' | 'failed'; error: string | null; groups: { company_id: string } | { company_id: string }[] } | null;
  const company = Array.isArray(row?.groups) ? row?.groups[0]?.company_id : row?.groups?.company_id;
  if (!row || company !== profile.company_id) return { ok: false, error: 'Mensagem de teste não encontrada.' };
  return { ok: true, status: row.status, error: row.error };
}

// ---------------------------------------------------------------------
// Setores (somente admin): grupos e usuários de cada setor e as permissões

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
