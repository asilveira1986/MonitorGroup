import { check, db } from '../db.js';
import type { AlertInput, AutomationRule, AutomationStore, EscalationStep, LogAction, NewPending, OpenPending, PendingReply } from './types.js';

type RuleRow = {
  group_id: string;
  company_id: string;
  enabled: boolean;
  ack_enabled: boolean;
  ack_message: string;
  ack_off_hours: string;
  ack_cooldown_min: number;
  last_ack_at: string | null;
  notify_group_jid: string;
  notify_group_name: string;
  escalate_after_min: number;
  repeat_every_min: number;
  max_escalations: number;
  escalate_off_hours: boolean;
  mention_jids: string[] | null;
  escalation_steps?: unknown;
  business_days: number[] | null;
  business_start: string;
  business_end: string;
};

type PendingRow = {
  id: string;
  company_id: string;
  group_id: string;
  instance_id: string | null;
  group_jid: string;
  first_message_id: string;
  client_name: string | null;
  preview: string;
  message_count: number;
  received_at: string;
  escalation_count: number;
  last_escalated_at: string | null;
  alert_id: string | null;
};

/** Etapas guardadas em jsonb -> lista segura (campos que faltam viram o padrão; entrada estranha é ignorada). */
export function parseSteps(raw: unknown): EscalationStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .slice(0, 10)
    .map((s) => ({
      waitMin: typeof s.waitMin === 'number' && Number.isFinite(s.waitMin) && s.waitMin >= 0 ? Math.floor(s.waitMin) : null,
      mentionGroupResponsibles: s.mentionGroupResponsibles === true,
      mentionSectorResponsibles: s.mentionSectorResponsibles === true,
      mentionJids: Array.isArray(s.mentionJids) ? s.mentionJids.filter((j): j is string => typeof j === 'string') : [],
    }));
}

const toRule = (r: RuleRow): AutomationRule => ({
  groupId: r.group_id,
  companyId: r.company_id,
  enabled: r.enabled,
  ackEnabled: r.ack_enabled,
  ackMessage: r.ack_message,
  ackOffHours: r.ack_off_hours,
  ackCooldownMin: r.ack_cooldown_min,
  lastAckAt: r.last_ack_at ? new Date(r.last_ack_at) : null,
  notifyGroupJid: r.notify_group_jid,
  notifyGroupName: r.notify_group_name,
  escalateAfterMin: r.escalate_after_min,
  repeatEveryMin: r.repeat_every_min,
  maxEscalations: r.max_escalations,
  escalateOffHours: r.escalate_off_hours,
  mentionJids: r.mention_jids ?? [],
  escalationSteps: parseSteps(r.escalation_steps),
  businessDays: r.business_days ?? [1, 2, 3, 4, 5],
  businessStart: r.business_start,
  businessEnd: r.business_end,
});

const toPending = (r: PendingRow, groupName: string): PendingReply => ({
  id: r.id,
  companyId: r.company_id,
  groupId: r.group_id,
  instanceId: r.instance_id,
  groupJid: r.group_jid,
  groupName,
  firstMessageId: r.first_message_id,
  clientName: r.client_name,
  preview: r.preview,
  messageCount: r.message_count,
  receivedAt: new Date(r.received_at),
  escalationCount: r.escalation_count,
  lastEscalatedAt: r.last_escalated_at ? new Date(r.last_escalated_at) : null,
  alertId: r.alert_id,
});

/** Tipos de alerta criados pela automação: saem da tela quando a demanda é encerrada. */
const ALERT_TYPES = ['new_message', 'no_reply'];

/** Automação sobre o Supabase (chave de serviço do worker). */
export function createSupabaseStore(): AutomationStore {
  return {
    async isEnabled(companyId) {
      const row = check(
        await db.from('app_settings').select('automation_enabled').eq('company_id', companyId).maybeSingle(),
        'automation enabled',
      ) as { automation_enabled: boolean | null } | null;
      return Boolean(row?.automation_enabled);
    },

    async getRule(groupId) {
      const row = check(await db.from('automation_rules').select('*').eq('group_id', groupId).maybeSingle(), 'automation rule') as RuleRow | null;
      return row ? toRule(row) : null;
    },

    async resolveResponsibles(groupId) {
      const group = check(
        await db.from('groups').select('sector_id, responsible_member_ids, responsible_member_id').eq('id', groupId).maybeSingle(),
        'automation group responsibles',
      ) as { sector_id: string | null; responsible_member_ids: string[] | null; responsible_member_id: string | null } | null;
      if (!group) return { group: [], sector: [] };
      const groupIds = group.responsible_member_ids?.length ? group.responsible_member_ids : group.responsible_member_id ? [group.responsible_member_id] : [];
      // sem o script 0158 a coluna do setor não existe: só os responsáveis do grupo
      let sectorIds: string[] = [];
      if (group.sector_id) {
        const { data } = await db.from('sectors').select('responsible_member_ids').eq('id', group.sector_id).maybeSingle();
        sectorIds = ((data as { responsible_member_ids: string[] | null } | null)?.responsible_member_ids ?? []) as string[];
      }
      const all = [...new Set([...groupIds, ...sectorIds])];
      if (!all.length) return { group: [], sector: [] };
      const members = (check(await db.from('team_members').select('id, phone, jid, active').in('id', all), 'automation responsibles members') ?? []) as {
        id: string;
        phone: string | null;
        jid: string | null;
        active: boolean;
      }[];
      const jidOf = new Map<string, string>();
      for (const m of members) {
        const jid = m.jid ?? (m.phone ? `${m.phone.replace(/\D/g, '')}@s.whatsapp.net` : null);
        if (m.active && jid) jidOf.set(m.id, jid);
      }
      const pick = (ids: string[]) => [...new Set(ids.map((id) => jidOf.get(id)).filter((j): j is string => Boolean(j)))];
      return { group: pick(groupIds), sector: pick(sectorIds) };
    },

    async listNotifyJids() {
      const rows = (check(await db.from('automation_rules').select('notify_group_jid'), 'automation notify jids') ?? []) as { notify_group_jid: string }[];
      return rows.map((r) => r.notify_group_jid);
    },

    async getOpenPending(groupId) {
      const row = check(
        await db.from('automation_pending').select('*, groups(name)').eq('group_id', groupId).is('resolved_at', null).maybeSingle(),
        'automation open pending',
      ) as (PendingRow & { groups: { name: string } | null }) | null;
      return row ? toPending(row, row.groups?.name ?? '') : null;
    },

    async createPending(p: NewPending) {
      const { data, error } = await db
        .from('automation_pending')
        .insert({
          company_id: p.companyId,
          group_id: p.groupId,
          instance_id: p.instanceId,
          group_jid: p.groupJid,
          first_message_id: p.firstMessageId,
          client_name: p.clientName,
          preview: p.preview,
          message_count: p.messageCount,
          received_at: p.receivedAt.toISOString(),
        })
        .select('*')
        .single();
      // índice único: já existe uma demanda aberta neste grupo
      if (error?.code === '23505') return null;
      if (error) throw new Error(`automation create pending: ${error.message}`);
      return toPending(data as PendingRow, p.groupName);
    },

    async bumpPending(id, preview, messageCount) {
      check(await db.from('automation_pending').update({ preview, message_count: messageCount }).eq('id', id), 'automation bump');
    },

    async setPendingAlert(id, alertId) {
      check(await db.from('automation_pending').update({ alert_id: alertId }).eq('id', id), 'automation pending alert');
    },

    async markEscalated(id, count, at) {
      check(
        await db.from('automation_pending').update({ escalation_count: count, last_escalated_at: at.toISOString() }).eq('id', id),
        'automation escalated',
      );
    },

    async resolvePending(id, by, responseSec, at) {
      check(
        await db
          .from('automation_pending')
          .update({ resolved_at: at.toISOString(), resolved_by: by, response_sec: responseSec })
          .eq('id', id)
          .is('resolved_at', null),
        'automation resolve',
      );
    },

    async listOpenPending(): Promise<OpenPending[]> {
      const rows = (check(
        await db.from('automation_pending').select('*, groups(name, pending_since)').is('resolved_at', null).order('received_at'),
        'automation list open',
      ) ?? []) as (PendingRow & { groups: { name: string; pending_since: string | null } | null })[];
      if (!rows.length) return [];
      const rules = (check(
        await db.from('automation_rules').select('*').in('group_id', [...new Set(rows.map((r) => r.group_id))]),
        'automation rules of open',
      ) ?? []) as RuleRow[];
      const byGroup = new Map(rules.map((r) => [r.group_id, toRule(r)]));
      return rows.map((r) => ({
        pending: toPending(r, r.groups?.name ?? ''),
        rule: byGroup.get(r.group_id) ?? null,
        groupStillPending: Boolean(r.groups?.pending_since),
      }));
    },

    async createAlert(a: AlertInput) {
      const row = check(
        await db
          .from('alerts')
          .insert({
            rule_id: null,
            type: a.type,
            severity: a.severity,
            group_id: a.groupId,
            instance_id: a.instanceId,
            message_id: a.messageId ?? null,
            title: a.title,
            description: a.description,
          })
          .select('id')
          .single(),
        'automation alert',
      ) as { id: string };
      return row.id;
    },

    async updateAlert(id, patch) {
      check(await db.from('alerts').update({ description: patch.description }).eq('id', id).neq('status', 'resolved'), 'automation alert update');
    },

    async resolveAlerts(groupId, at) {
      check(
        await db
          .from('alerts')
          .update({ status: 'resolved', resolved_at: at.toISOString() })
          .eq('group_id', groupId)
          .in('type', ALERT_TYPES)
          .neq('status', 'resolved'),
        'automation resolve alerts',
      );
    },

    async setLastAck(groupId, at) {
      check(await db.from('automation_rules').update({ last_ack_at: at.toISOString() }).eq('group_id', groupId), 'automation last ack');
    },

    async log(companyId: string, groupId: string, action: LogAction, detail: string | null) {
      check(await db.from('automation_log').insert({ company_id: companyId, group_id: groupId, action, detail }), 'automation log');
    },
  };
}
