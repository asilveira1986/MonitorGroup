import { db } from '../db.js';
import { DEFAULT_SETTINGS, normalizeSettings, phoneKey } from './service.js';
import type { BroadcastStore, Campaign, Recipient } from './types.js';

type CampaignRow = {
  id: string;
  company_id: string;
  name: string;
  target: 'groups' | 'people';
  message: string;
  // colunas da 0151 (ausentes se o script ainda não foi rodado)
  variants?: string[] | null;
  media_path?: string | null;
  media_mime?: string | null;
  media_name?: string | null;
  media_type?: 'image' | 'video' | 'document' | 'audio' | null;
  window_enabled?: boolean | null;
  window_days?: number[] | null;
  window_start?: string | null;
  window_end?: string | null;
  optout_footer?: boolean | null;
};
type RecipientRow = {
  id: string;
  campaign_id: string;
  kind: 'group' | 'person';
  name: string | null;
  phone: string | null;
  jid: string | null;
  instance_id: string | null;
};

const must = (error: { message: string } | null, context: string) => {
  if (error) throw new Error(`broadcast ${context}: ${error.message}`);
};

/** Disparos sobre o Supabase (chave de serviço do worker). */
export function createSupabaseBroadcastStore(): BroadcastStore {
  return {
    async startDue(now) {
      const { error } = await db
        .from('broadcast_campaigns')
        .update({ status: 'running', started_at: now.toISOString() })
        .eq('status', 'scheduled')
        .lte('scheduled_at', now.toISOString());
      must(error, 'start due');
    },

    async listRunning() {
      const { data, error } = await db
        .from('broadcast_campaigns')
        // "*": sem o script 0151 as colunas novas não existem e os disparos simples seguem funcionando
        .select('*')
        .eq('status', 'running')
        .order('scheduled_at');
      must(error, 'list running');
      return ((data ?? []) as CampaignRow[]).map(
        (c): Campaign => ({
          id: c.id,
          companyId: c.company_id,
          name: c.name,
          target: c.target,
          message: c.message,
          variants: c.variants ?? [],
          media: c.media_path && c.media_type ? { path: c.media_path, type: c.media_type, mime: c.media_mime ?? 'application/octet-stream', name: c.media_name ?? null } : null,
          window: c.window_enabled ? { days: c.window_days ?? [1, 2, 3, 4, 5], start: c.window_start ?? '08:00', end: c.window_end ?? '18:00' } : null,
          optoutFooter: c.optout_footer ?? false,
        }),
      );
    },

    async getSettings(companyId) {
      const { data, error } = await db.from('app_settings').select('*').eq('company_id', companyId).maybeSingle();
      // sem as colunas (script 0150 por rodar) ou sem linha: o padrão seguro
      if (error || !data) return { ...DEFAULT_SETTINGS };
      return normalizeSettings(data as Record<string, unknown>);
    },

    async listPending(campaignId, limit) {
      const { data, error } = await db
        .from('broadcast_recipients')
        .select('id, campaign_id, kind, name, phone, jid, instance_id')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .order('created_at')
        .order('id')
        .limit(limit);
      must(error, 'list pending');
      return ((data ?? []) as RecipientRow[]).map(
        (r): Recipient => ({
          id: r.id,
          campaignId: r.campaign_id,
          kind: r.kind,
          name: r.name,
          phone: r.phone,
          jid: r.jid,
          instanceId: r.instance_id,
        }),
      );
    },

    async claim(recipientId) {
      const { data, error } = await db
        .from('broadcast_recipients')
        .update({ status: 'sending' })
        .eq('id', recipientId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      must(error, 'claim');
      return Boolean(data);
    },

    async markSent(recipientId, waMessageId, sentAt) {
      const { error } = await db
        .from('broadcast_recipients')
        .update({ status: 'sent', wa_message_id: waMessageId, sent_at: sentAt.toISOString(), error: null })
        .eq('id', recipientId);
      must(error, 'mark sent');
    },

    async markFailed(recipientId, message) {
      const { error } = await db.from('broadcast_recipients').update({ status: 'failed', error: message.slice(0, 300) }).eq('id', recipientId);
      must(error, 'mark failed');
    },

    async isOptedOut(companyId, phone) {
      const { data, error } = await db.from('broadcast_optouts').select('phone').eq('company_id', companyId);
      // sem o script 0151 não há lista de opt-out
      if (error) return false;
      const key = phoneKey(phone);
      return ((data ?? []) as { phone: string }[]).some((o) => phoneKey(o.phone) === key);
    },

    async markSkipped(recipientId, reason) {
      const { error } = await db.from('broadcast_recipients').update({ status: 'skipped', error: reason.slice(0, 300) }).eq('id', recipientId);
      must(error, 'mark skipped');
    },

    async loadMedia(path) {
      const file = await db.storage.from('media').download(path);
      if (file.error || !file.data) throw new Error('Arquivo do disparo não encontrado no Storage.');
      return Buffer.from(await file.data.arrayBuffer());
    },

    async countSent(instanceId, since) {
      const { count, error } = await db
        .from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', instanceId)
        .eq('status', 'sent')
        .gte('sent_at', since.toISOString());
      must(error, 'count sent');
      return count ?? 0;
    },

    async openCount(campaignId) {
      const { count, error } = await db
        .from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .in('status', ['pending', 'sending']);
      must(error, 'open count');
      return count ?? 0;
    },

    async finish(campaignId) {
      const { error } = await db
        .from('broadcast_campaigns')
        .update({ status: 'done', finished_at: new Date().toISOString() })
        .eq('id', campaignId)
        .eq('status', 'running');
      must(error, 'finish');
    },

    async pause(campaignId) {
      const { error } = await db.from('broadcast_campaigns').update({ status: 'paused' }).eq('id', campaignId).eq('status', 'running');
      must(error, 'pause');
    },

    async failStuck() {
      const { data, error } = await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error: 'Interrompido por um reinício do sistema; não foi reenviado para não duplicar.' })
        .eq('status', 'sending')
        .select('id');
      must(error, 'fail stuck');
      return data?.length ?? 0;
    },
  };
}
