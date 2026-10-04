import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type InstanceRow = {
  id: string;
  name: string;
  phone: string | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  requested_action: 'connect' | 'logout' | 'reimport' | null;
  connected_at: string | null;
};

export type GroupRow = {
  id: string;
  instance_id: string;
  jid: string;
  name: string;
  monitored: boolean;
  sla_minutes: number | null;
  pending_since: string | null;
  last_message_at: string | null;
  removed_at: string | null;
  created_at: string;
};

export type TeamMemberRow = {
  id: string;
  name: string;
  phone: string | null;
  jid: string | null;
  active: boolean;
};

export type AppSettings = {
  company_name: string;
  timezone: string;
  business_days: number[];
  business_start: string;
  business_end: string;
  default_sla_minutes: number;
  auto_monitor_new_groups: boolean;
  ignore_acknowledgements: boolean;
  history_import_days: number;
};

export type AlertRule = {
  id: string;
  name: string;
  type: 'no_response' | 'keyword' | 'high_volume' | 'disconnected' | 'inactivity';
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  threshold_minutes: number | null;
  threshold_count: number | null;
  keywords: string[] | null;
  group_ids: string[] | null;
  business_hours_only: boolean;
  cooldown_minutes: number;
  notify_in_app: boolean;
  notify_emails: string[];
  notify_whatsapp: string[];
  notify_webhook_url: string | null;
  indicator_key?: string | null;
};

/** Lança erro se a resposta do Supabase tiver falhado. */
export function check<T>(res: { data: T; error: { message: string } | null }, context: string): T {
  if (res.error) {
    throw new Error(`${context}: ${res.error.message}`);
  }
  return res.data;
}
