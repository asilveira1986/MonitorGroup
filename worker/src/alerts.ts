import { getSettings } from './cache.js';
import { check, db, type AlertRule, type GroupRow } from './db.js';
import { isWithinBusinessHours } from './business-hours.js';
import { logger } from './logger.js';
import { sendNotifications } from './notify.js';
import { findKeyword } from './text.js';

const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/**
 * Indicadores cujo alerta está liberado (indicador ligado, bloco ligado e alerta ligado).
 * Lido do catálogo a cada verificação: mudanças no painel valem sem reiniciar o worker.
 */
async function alertableIndicators(): Promise<Set<string> | null> {
  const { data, error } = await db
    .from('indicators')
    .select('key, enabled, alert_enabled, indicator_blocks!inner(enabled)');
  if (error) return null; // catálogo ainda não criado (script 0008 não executado): mantém o comportamento antigo
  const rows = (data ?? []) as unknown as {
    key: string;
    enabled: boolean;
    alert_enabled: boolean;
    indicator_blocks: { enabled: boolean };
  }[];
  return new Set(rows.filter((r) => r.enabled && r.alert_enabled && r.indicator_blocks.enabled).map((r) => r.key));
}

export async function loadRules(type?: AlertRule['type']): Promise<AlertRule[]> {
  let query = db.from('alert_rules').select('*').eq('active', true);
  if (type) query = query.eq('type', type);
  const rules = (check(await query, 'load rules') ?? []) as AlertRule[];
  const allowed = await alertableIndicators();
  if (!allowed) return rules;
  // regra ligada a um indicador desativado (ou com alerta desligado) não dispara
  return rules.filter((r) => !r.indicator_key || allowed.has(r.indicator_key));
}

const appliesToGroup = (rule: AlertRule, groupId: string) => !rule.group_ids?.length || rule.group_ids.includes(groupId);

async function inBusinessHours() {
  const s = await getSettings();
  return isWithinBusinessHours(new Date(), {
    timezone: s.timezone,
    businessDays: s.business_days,
    start: s.business_start,
    end: s.business_end,
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
}

/** Já existe alerta desta regra para o alvo desde `since`? */
async function hasRecentAlert(ruleId: string, target: { groupId?: string; instanceId?: string }, since: string) {
  let query = db.from('alerts').select('id').eq('rule_id', ruleId).gte('created_at', since).limit(1);
  if (target.groupId) query = query.eq('group_id', target.groupId);
  if (target.instanceId) query = query.eq('instance_id', target.instanceId);
  const rows = check(await query, 'check recent alert') ?? [];
  return rows.length > 0;
}

async function createAlert(
  rule: AlertRule,
  data: {
    title: string;
    description: string;
    groupId?: string;
    groupName?: string;
    instanceId?: string;
    messageId?: string;
    demandId?: string;
  },
) {
  const inserted = check(
    await db
      .from('alerts')
      .insert({
        rule_id: rule.id,
        type: rule.type,
        severity: rule.severity,
        group_id: data.groupId ?? null,
        instance_id: data.instanceId ?? null,
        message_id: data.messageId ?? null,
        demand_id: data.demandId ?? null,
        title: data.title,
        description: data.description,
      })
      .select('id, created_at')
      .single(),
    'create alert',
  )!;

  logger.info({ rule: rule.name, title: data.title }, 'alerta criado');

  const channels = await sendNotifications(rule, {
    id: inserted.id,
    title: data.title,
    description: data.description,
    severity: rule.severity,
    type: rule.type,
    groupName: data.groupName,
    createdAt: inserted.created_at,
  });
  if (channels.length) {
    await db.from('alerts').update({ notified_channels: channels }).eq('id', inserted.id);
  }
}

// ---------------------------------------------------------------------
// Verificações periódicas (a cada minuto)
// ---------------------------------------------------------------------

async function checkNoResponse(rules: AlertRule[], businessHours: boolean) {
  for (const rule of rules) {
    if (!rule.threshold_minutes) continue;
    if (rule.business_hours_only && !businessHours) continue;

    const groups = (check(
      await db
        .from('groups')
        .select('id, name, pending_since, pending_count, pending_message_id')
        .eq('monitored', true)
        .is('removed_at', null)
        .not('pending_since', 'is', null)
        .lte('pending_since', minutesAgo(rule.threshold_minutes)),
      'pending groups',
    ) ?? []) as (GroupRow & { pending_count: number; pending_message_id: string | null })[];

    for (const group of groups) {
      if (!appliesToGroup(rule, group.id)) continue;
      // um alerta por pendência: só alerta de novo se a pendência for nova
      if (await hasRecentAlert(rule.id, { groupId: group.id }, group.pending_since!)) continue;

      let preview = '';
      if (group.pending_message_id) {
        const msg = (
          await db.from('messages').select('sender_name, sender_phone, body').eq('id', group.pending_message_id).maybeSingle()
        ).data;
        if (msg) preview = `\n${msg.sender_name ?? msg.sender_phone ?? 'Cliente'}: "${(msg.body ?? '[mídia]').slice(0, 200)}"`;
      }
      const waited = (Date.now() - new Date(group.pending_since!).getTime()) / 1000;
      await createAlert(rule, {
        title: `Sem resposta há ${formatDuration(waited)} - ${group.name}`,
        description: `${group.pending_count} mensagem(ns) de cliente aguardando resposta no grupo "${group.name}".${preview}`,
        groupId: group.id,
        groupName: group.name,
        messageId: group.pending_message_id ?? undefined,
      });
    }
  }
}

async function checkInactivity(rules: AlertRule[], businessHours: boolean) {
  for (const rule of rules) {
    if (!rule.threshold_minutes) continue;
    if (rule.business_hours_only && !businessHours) continue;
    const limit = minutesAgo(rule.threshold_minutes);

    const groups = (check(
      await db
        .from('groups')
        .select('id, name, last_message_at, created_at')
        .eq('monitored', true)
        .is('removed_at', null)
        .or(`last_message_at.lte.${limit},and(last_message_at.is.null,created_at.lte.${limit})`),
      'inactive groups',
    ) ?? []) as GroupRow[];

    for (const group of groups) {
      if (!appliesToGroup(rule, group.id)) continue;
      const since = group.last_message_at ?? group.created_at;
      if (await hasRecentAlert(rule.id, { groupId: group.id }, since)) continue;
      await createAlert(rule, {
        title: `Grupo sem movimentação - ${group.name}`,
        description: `Nenhuma mensagem no grupo "${group.name}" há mais de ${formatDuration(rule.threshold_minutes * 60)}.`,
        groupId: group.id,
        groupName: group.name,
      });
    }
  }
}

async function checkDisconnected(rules: AlertRule[]) {
  const instances =
    check(
      await db
        .from('whatsapp_instances')
        .select('id, name, status, connected_at, last_error')
        .neq('status', 'connected')
        .not('connected_at', 'is', null)
        // tolerância de 2 minutos para reconexões rápidas
        .lt('last_seen_at', minutesAgo(2)),
      'disconnected instances',
    ) ?? [];

  for (const rule of rules) {
    for (const inst of instances) {
      const since = minutesAgo(Math.max(rule.cooldown_minutes, 1));
      if (await hasRecentAlert(rule.id, { instanceId: inst.id }, since)) continue;
      const open = check(
        await db.from('alerts').select('id').eq('instance_id', inst.id).eq('type', 'disconnected').neq('status', 'resolved').limit(1),
        'open disconnect alerts',
      );
      if (open?.length) continue;
      await createAlert(rule, {
        title: `WhatsApp desconectado - ${inst.name}`,
        description: `A conexão "${inst.name}" está desconectada. As mensagens dos grupos não estão sendo monitoradas. Acesse Configurações > WhatsApp e leia o QR code novamente.${inst.last_error ? `\nMotivo: ${inst.last_error}` : ''}`,
        instanceId: inst.id,
      });
    }
  }
}

/**
 * Reincidência de falta de resposta: grupo com N falhas (fora do SLA ou ainda sem
 * resposta) na janela da regra. Avisa de novo só quando houver falha nova depois do
 * último aviso e passado o intervalo mínimo da regra.
 */
async function checkRecurrence(rules: AlertRule[], businessHours: boolean) {
  for (const rule of rules) {
    if (!rule.threshold_count || !rule.threshold_minutes) continue;
    if (rule.business_hours_only && !businessHours) continue;
    const { data, error } = await db.rpc('recurrence_alert_candidates', {
      p_window_minutes: rule.threshold_minutes,
      p_min_failures: rule.threshold_count,
    });
    if (error) {
      logger.warn({ error: error.message }, 'reincidência: execute o script 0015 no Supabase');
      return;
    }
    const days = Math.max(1, Math.round(rule.threshold_minutes / 1440));
    for (const g of (data ?? []) as {
      group_id: string;
      group_name: string;
      failures: number;
      last_failure: string;
      worst_seconds: number | null;
    }[]) {
      if (!appliesToGroup(rule, g.group_id)) continue;
      const { data: last } = await db
        .from('alerts')
        .select('created_at')
        .eq('rule_id', rule.id)
        .eq('group_id', g.group_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last) {
        const lastAt = new Date(last.created_at).getTime();
        if (new Date(g.last_failure).getTime() <= lastAt) continue; // nenhuma falha nova desde o último aviso
        if (Date.now() - lastAt < rule.cooldown_minutes * 60_000) continue;
      }
      await createAlert(rule, {
        title: `Falta de resposta reincidente - ${g.group_name}`,
        description:
          `O grupo "${g.group_name}" teve ${g.failures} falhas de resposta (fora do SLA ou ainda sem resposta) ` +
          `nos últimos ${days} dia(s).` +
          (g.worst_seconds ? ` Maior atraso: ${formatDuration(g.worst_seconds)}.` : ''),
        groupId: g.group_id,
        groupName: g.group_name,
      });
    }
  }
}

let running = false;

export async function runPeriodicChecks() {
  if (running) return;
  running = true;
  try {
    const rules = await loadRules();
    const businessHours = await inBusinessHours();
    await checkNoResponse(rules.filter((r) => r.type === 'no_response'), businessHours);
    await checkInactivity(rules.filter((r) => r.type === 'inactivity'), businessHours);
    await checkDisconnected(rules.filter((r) => r.type === 'disconnected'));
    await checkDeadlines(rules.filter((r) => r.type === 'deadline_missed'));
    await checkRecurrence(rules.filter((r) => r.type === 'recurrence'), businessHours);
  } catch (err) {
    logger.error({ err }, 'erro na verificação de alertas');
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------
// Verificações em tempo real (a cada mensagem de cliente)
// ---------------------------------------------------------------------

export async function onClientMessage(group: { id: string; name: string }, message: { id: string; body: string | null; senderName: string | null }) {
  try {
    const rules = (await loadRules()).filter(
      (r) => (r.type === 'keyword' || r.type === 'high_volume') && appliesToGroup(r, group.id),
    );
    if (!rules.length) return;
    const businessHours = await inBusinessHours();

    for (const rule of rules) {
      if (rule.business_hours_only && !businessHours) continue;
      const cooldownSince = minutesAgo(rule.cooldown_minutes);

      if (rule.type === 'keyword') {
        const keyword = findKeyword(message.body, rule.keywords);
        if (!keyword) continue;
        if (await hasRecentAlert(rule.id, { groupId: group.id }, cooldownSince)) continue;
        await createAlert(rule, {
          title: `Palavra-chave "${keyword}" - ${group.name}`,
          description: `${message.senderName ?? 'Cliente'}: "${(message.body ?? '').slice(0, 300)}"`,
          groupId: group.id,
          groupName: group.name,
          messageId: message.id,
        });
      }

      if (rule.type === 'high_volume' && rule.threshold_count && rule.threshold_minutes) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .eq('from_team', false)
          .gte('sent_at', minutesAgo(rule.threshold_minutes));
        if ((count ?? 0) < rule.threshold_count) continue;
        if (await hasRecentAlert(rule.id, { groupId: group.id }, cooldownSince)) continue;
        await createAlert(rule, {
          title: `Volume alto de mensagens - ${group.name}`,
          description: `${count} mensagens de clientes nos últimos ${rule.threshold_minutes} min no grupo "${group.name}".`,
          groupId: group.id,
          groupName: group.name,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'erro ao avaliar alertas da mensagem');
  }
}

/** Ao reconectar, resolve os alertas de desconexão em aberto. */
export async function resolveDisconnectAlerts(instanceId: string) {
  await db
    .from('alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('instance_id', instanceId)
    .eq('type', 'disconnected')
    .neq('status', 'resolved');
}

// ---------------------------------------------------------------------
// Demandas: prazo prometido vencido e retrabalho
// ---------------------------------------------------------------------

/** Já existe alerta desta regra para a demanda? (um alerta por demanda) */
async function demandAlerted(ruleId: string, demandId: string) {
  const rows = check(
    await db.from('alerts').select('id').eq('rule_id', ruleId).eq('demand_id', demandId).limit(1),
    'demand alert',
  );
  return (rows ?? []).length > 0;
}

async function checkDeadlines(rules: AlertRule[]) {
  if (!rules.length) return;
  const { data } = await db
    .from('demands')
    .select('id, number, description, promised_at, group_id, groups!inner(name, monitored, removed_at)')
    .in('status', ['aberta', 'em_andamento'])
    .lt('promised_at', new Date().toISOString());
  const overdue = (data ?? []) as unknown as {
    id: string;
    number: number;
    description: string;
    promised_at: string;
    group_id: string;
    groups: { name: string; monitored: boolean; removed_at: string | null };
  }[];
  for (const rule of rules) {
    for (const d of overdue) {
      if (!d.groups.monitored || d.groups.removed_at || !appliesToGroup(rule, d.group_id)) continue;
      if (await demandAlerted(rule.id, d.id)) continue;
      const late = (Date.now() - new Date(d.promised_at).getTime()) / 1000;
      await createAlert(rule, {
        title: `Prazo vencido há ${formatDuration(late)} - demanda #${d.number}`,
        description: `"${d.description.slice(0, 200)}" no grupo "${d.groups.name}" não foi entregue no prazo prometido.`,
        groupId: d.group_id,
        groupName: d.groups.name,
        demandId: d.id,
      });
    }
  }
}

/** Chamado pelo módulo de demandas quando uma demanda é reaberta ou muito cobrada. */
export async function onRework(demandId: string, groupId: string, groupName: string, reason: string) {
  try {
    const rules = (await loadRules('rework')).filter((r) => appliesToGroup(r, groupId));
    if (!rules.length) return;
    const { data: d } = await db.from('demands').select('number, description').eq('id', demandId).single();
    for (const rule of rules) {
      if (await demandAlerted(rule.id, demandId)) continue;
      await createAlert(rule, {
        title: `Retrabalho na demanda #${d?.number ?? ''} - ${groupName}`,
        description: `"${(d?.description ?? '').slice(0, 200)}" foi ${reason}.`,
        groupId,
        groupName,
        demandId,
      });
    }
  } catch (err) {
    logger.error({ err }, 'erro ao avaliar alerta de retrabalho');
  }
}
