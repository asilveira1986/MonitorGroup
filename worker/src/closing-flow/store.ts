import { check, db } from '../db.js';
import type { ClosingFlow, ClosingOption, ClosingStore, Survey, SurveyStatus } from './types.js';

type FlowRow = {
  id: string;
  company_id: string;
  enabled: boolean;
  name: string;
  question: string;
  options: ClosingOption[] | null;
  group_ids: string[] | null;
  delay_min: number;
  expire_hours: number;
  notify_group_jid: string | null;
  notify_group_name: string | null;
  mention_jids: string[] | null;
};

type SurveyRow = {
  id: string;
  company_id: string;
  flow_id: string | null;
  group_id: string;
  instance_id: string | null;
  group_jid: string;
  status: SurveyStatus;
  send_at: string;
  expires_at: string | null;
  poll_wa_id: string | null;
  question: string;
  options: ClosingOption[] | null;
  groups?: { name: string } | null;
};

const toFlow = (r: FlowRow): ClosingFlow => ({
  id: r.id,
  companyId: r.company_id,
  enabled: r.enabled,
  name: r.name,
  question: r.question,
  options: r.options ?? [],
  groupIds: r.group_ids ?? [],
  delayMin: r.delay_min,
  expireHours: r.expire_hours,
  notifyGroupJid: r.notify_group_jid,
  notifyGroupName: r.notify_group_name,
  mentionJids: r.mention_jids ?? [],
});

const toSurvey = (r: SurveyRow): Survey => ({
  id: r.id,
  companyId: r.company_id,
  flowId: r.flow_id,
  groupId: r.group_id,
  groupName: r.groups?.name ?? '',
  instanceId: r.instance_id,
  groupJid: r.group_jid,
  status: r.status,
  sendAt: new Date(r.send_at),
  expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  pollWaId: r.poll_wa_id,
  question: r.question,
  options: r.options ?? [],
});

const SELECT = '*, groups(name)';

/** Pesquisa de encerramento sobre o Supabase (chave de serviço do worker). */
export function createSupabaseClosingStore(): ClosingStore {
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) =>
    check(await q, what) as SurveyRow | null;

  return {
    async getFlowForGroup(groupId) {
      const rows = (check(await db.from('closing_flows').select('*').eq('enabled', true).contains('group_ids', [groupId]).order('created_at').limit(1), 'closing flow') ?? []) as FlowRow[];
      return rows[0] ? toFlow(rows[0]) : null;
    },
    async getFlow(id) {
      const row = check(await db.from('closing_flows').select('*').eq('id', id).maybeSingle(), 'closing flow') as FlowRow | null;
      return row ? toFlow(row) : null;
    },
    async createSurvey(s) {
      const { data, error } = await db
        .from('closing_surveys')
        .insert({
          company_id: s.companyId,
          flow_id: s.flowId,
          group_id: s.groupId,
          instance_id: s.instanceId,
          group_jid: s.groupJid,
          send_at: s.sendAt.toISOString(),
          question: s.question,
          options: s.options,
        })
        .select(SELECT)
        .single();
      if (error) {
        if (error.code === '23505') return null; // já há uma pergunta em andamento neste grupo
        throw new Error(`closing survey: ${error.message}`);
      }
      return toSurvey(data as SurveyRow);
    },
    async cancelScheduled(groupId) {
      const rows = (check(await db.from('closing_surveys').update({ status: 'cancelled' }).eq('group_id', groupId).eq('status', 'scheduled').select('id'), 'closing cancel') ?? []) as unknown[];
      return rows.length;
    },
    async getSentSurvey(groupId) {
      const row = await one(db.from('closing_surveys').select(SELECT).eq('group_id', groupId).eq('status', 'sent').maybeSingle(), 'closing sent');
      return row ? toSurvey(row) : null;
    },
    async findSentByPoll(pollWaId) {
      const row = await one(db.from('closing_surveys').select(SELECT).eq('poll_wa_id', pollWaId).eq('status', 'sent').maybeSingle(), 'closing poll');
      return row ? toSurvey(row) : null;
    },
    async listDue(now) {
      const rows = (check(await db.from('closing_surveys').select(SELECT).eq('status', 'scheduled').lte('send_at', now.toISOString()).order('send_at').limit(20), 'closing due') ?? []) as SurveyRow[];
      return rows.map(toSurvey);
    },
    async listExpired(now) {
      const rows = (check(await db.from('closing_surveys').select(SELECT).eq('status', 'sent').lte('expires_at', now.toISOString()).limit(50), 'closing expired') ?? []) as SurveyRow[];
      return rows.map(toSurvey);
    },
    async markSent(id, info) {
      check(
        await db
          .from('closing_surveys')
          .update({ status: 'sent', poll_wa_id: info.pollWaId, poll_message: info.pollMessage, sent_at: info.sentAt.toISOString(), expires_at: info.expiresAt.toISOString() })
          .eq('id', id),
        'closing sent mark',
      );
    },
    async markExpired(id) {
      check(await db.from('closing_surveys').update({ status: 'expired' }).eq('id', id).eq('status', 'sent'), 'closing expire');
    },
    async markFailed(id) {
      check(await db.from('closing_surveys').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled'), 'closing fail');
    },
    async markAnswered(id, a) {
      const rows = (check(
        await db
          .from('closing_surveys')
          .update({ status: 'answered', answer_label: a.label, answer_index: a.index, answered_by: a.by, answered_at: a.at.toISOString() })
          .eq('id', id)
          .eq('status', 'sent')
          .select('id'),
        'closing answer',
      ) ?? []) as unknown[];
      return rows.length > 0;
    },
    async createAlert(a) {
      check(
        await db.from('alerts').insert({
          rule_id: null,
          type: 'closing_reopen',
          severity: a.severity,
          group_id: a.groupId,
          instance_id: a.instanceId,
          title: a.title,
          description: a.description,
        }),
        'closing alert',
      );
    },
    async reopenGroup(groupId, at) {
      check(await db.from('groups').update({ pending_since: at.toISOString() }).eq('id', groupId).is('pending_since', null), 'closing reopen');
    },
  };
}

/** Mensagem da enquete guardada (BufferJSON) pelo id: a chave para abrir os votos. */
export async function loadPollMessage(pollWaId: string): Promise<string | null> {
  const row = check(await db.from('closing_surveys').select('poll_message').eq('poll_wa_id', pollWaId).maybeSingle(), 'closing poll message') as { poll_message: string | null } | null;
  return row?.poll_message ?? null;
}
