export type Role = 'admin' | 'agent';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  active: boolean;
  created_at: string;
};

export type Instance = {
  id: string;
  name: string;
  phone: string | null;
  push_name: string | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  qr_code: string | null;
  qr_updated_at: string | null;
  requested_action: 'connect' | 'logout' | null;
  last_error: string | null;
  last_seen_at: string | null;
  connected_at: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  instance_id: string;
  jid: string;
  name: string;
  description: string | null;
  participants_count: number;
  monitored: boolean;
  sla_minutes: number | null;
  pending_since: string | null;
  pending_count: number;
  last_message_at: string | null;
  last_client_message_at: string | null;
  last_team_message_at: string | null;
  last_message_preview: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  group_id: string;
  wa_message_id: string;
  sender_jid: string | null;
  sender_phone: string | null;
  sender_name: string | null;
  from_me: boolean;
  from_team: boolean;
  team_member_id: string | null;
  message_type: string;
  body: string | null;
  sent_at: string;
  response_time_seconds: number | null;
  answered_message_id: string | null;
};

export type TeamMember = {
  id: string;
  name: string;
  phone: string | null;
  jid: string | null;
  active: boolean;
  created_at: string;
};

export type AlertType = 'no_response' | 'keyword' | 'high_volume' | 'disconnected' | 'inactivity';
export type Severity = 'info' | 'warning' | 'critical';

export type AlertRule = {
  id: string;
  name: string;
  type: AlertType;
  severity: Severity;
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
};

export type Alert = {
  id: string;
  rule_id: string | null;
  type: AlertType;
  severity: Severity;
  group_id: string | null;
  instance_id: string | null;
  message_id: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  notified_channels: string[];
  created_at: string;
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
};

export type PendingItem = {
  id: string;
  name: string;
  instance_id: string;
  pending_since: string;
  pending_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  sla_minutes: number;
  waiting_seconds: number;
  overdue: boolean;
  pending_sender_name: string | null;
  pending_sender_phone: string | null;
  pending_body: string | null;
};

export type DashboardData = {
  kpis: {
    received: number;
    sent: number;
    active_groups: number;
    monitored_groups: number;
    pending_groups: number;
    overdue_groups: number;
    oldest_pending: string | null;
    responses: number;
    avg_response_seconds: number | null;
    median_response_seconds: number | null;
    p90_response_seconds: number | null;
    responses_in_sla: number;
    unique_clients: number;
    open_alerts: number;
  };
  daily: {
    day: string;
    received: number;
    sent: number;
    avg_response_seconds: number | null;
    responses: number;
    in_sla: number;
  }[];
  hourly: { hour: number; received: number; sent: number }[];
  top_groups: {
    id: string;
    name: string;
    pending_since: string | null;
    pending_count: number;
    received: number;
    sent: number;
    avg_response_seconds: number | null;
  }[];
  team: { name: string; messages: number; responses: number; avg_response_seconds: number | null }[];
  buckets: { label: string; total: number }[];
  timezone: string;
  default_sla_minutes: number;
};
