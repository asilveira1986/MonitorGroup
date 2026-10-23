export type Role = 'admin' | 'agent' | 'viewer';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  /** empresa em que o usuário está (multiempresa) */
  company_id: string | null;
  /** administra a plataforma: cadastra empresas e entra em qualquer uma para dar suporte */
  platform_admin: boolean;
  /** desligou os avisos só para si (0058) */
  alerts_off?: boolean;
};

/** Empresa cliente (tela Empresas), com os números de uso. */
export type Company = {
  id: string;
  name: string;
  document: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  active: boolean;
  max_groups: number | null;
  max_users: number | null;
  notes: string | null;
  created_at: string;
  users: number;
  pending_invites: number;
  admins: string[];
  groups_monitored: number;
  connections: number;
  connected: number;
  messages_30d: number;
  last_message_at: string | null;
};

export type Instance = {
  id: string;
  name: string;
  phone: string | null;
  push_name: string | null;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  qr_code: string | null;
  qr_updated_at: string | null;
  requested_action: 'connect' | 'logout' | 'reimport' | 'sync_contacts' | null;
  history_status: 'idle' | 'importing' | 'done';
  history_imported: number;
  history_started_at: string | null;
  history_finished_at: string | null;
  last_error: string | null;
  last_seen_at: string | null;
  connected_at: string | null;
  created_at: string;
};

export type Group = {
  /** setor do grupo (define quem vê e atende) */
  sector_id?: string | null;
  /** nome do setor (quando a consulta inclui sectors(name)) */
  sectors?: { name: string } | null;
  /** conversa encerrada pela mensagem de fechamento (a próxima do cliente inicia outra) */
  closed_at?: string | null;
  conversation_started_at?: string | null;
  /** primeiro responsável pelo grupo (pessoa da equipe) */
  responsible_member_id?: string | null;
  /** responsáveis pelo grupo (pessoas da equipe, 0056) */
  responsible_member_ids?: string[] | null;
  /** nomes dos responsáveis (montado pela página) */
  responsible_names?: string[];
  /** nome do responsável (quando a consulta inclui team_members(name)) */
  team_members?: { name: string } | null;
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
  /** editada (no painel ou no WhatsApp) e o texto antes da 1ª edição (0066) */
  edited_at?: string | null;
  original_body?: string | null;
  /** apagada para todos; o texto continua guardado (0066) */
  deleted_at?: string | null;
  /** apagada para mim (só no número conectado): some da conversa do painel (0067) */
  hidden_at?: string | null;
  /** tiques do WhatsApp nas mensagens do número conectado: 2 enviada, 3 entregue, 4 lida, 5 ouvida (0068) */
  wa_status?: number | null;
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
  demand_id?: string | null;
  /** figurinha/emoji do cliente desconsiderado como última mensagem */
  ignored_as_last?: boolean;
  /** mensagem de fechamento da equipe (\fechamento): encerra a conversa */
  closes_conversation?: boolean;
  /** arquivo guardado (imagem, áudio...): caminho no bucket privado "media" */
  media_path?: string | null;
  media_mime?: string | null;
  media_size?: number | null;
  /** stored | too_large | failed | expired */
  media_status?: string | null;
  /** quando a mensagem do cliente foi vista: lida no celular conectado ou baixa no painel */
  seen_at?: string | null;
  seen_via?: string | null;
  seen_by?: string | null;
};

export type TeamMember = {
  /** e-mail do usuário do sistema criado para esta pessoa (Equipe › Dar acesso) */
  user_email?: string | null;
  /** recebe os avisos só dos grupos em que é responsável (0056) */
  alerts_own_groups_only?: boolean;
  id: string;
  name: string;
  phone: string | null;
  jid: string | null;
  active: boolean;
  created_at: string;
  /** foto enviada no cadastro (0083) */
  photo_path?: string | null;
};

export type AlertType =
  | 'no_response'
  | 'keyword'
  | 'high_volume'
  | 'disconnected'
  | 'inactivity'
  | 'deadline_missed'
  | 'rework'
  | 'recurrence';
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
  /** avisa também os responsáveis do grupo (WhatsApp e e-mail de acesso, 0056) */
  notify_responsibles?: boolean;
  /** o alerta desta regra é falado (aviso por voz) */
  voice?: boolean;
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
  ignore_stickers_emoji?: boolean;
  /** frases do cliente a ignorar (além dos agradecimentos padrão) */
  ignore_phrases?: string[];
  /** atalho da mensagem rápida que encerra a conversa (padrão "fechamento") */
  closing_shortcut?: string;
  /** fotos de perfil dos participantes e do grupo */
  avatars_enabled?: boolean;
  /** guarda imagens e áudios para ver no painel */
  media_store_enabled?: boolean;
  media_store_types?: string[];
  /** dias que os arquivos ficam guardados (0 = sempre) */
  media_retention_days?: number;
  history_import_days: number;
  demand_manual_enabled: boolean;
  demand_command_enabled: boolean;
  demand_keyword_enabled: boolean;
  demand_keywords: string[];
  demand_ai_enabled: boolean;
  /** abre demanda quando a equipe se compromete ("vou verificar", "te retorno", prazo) */
  demand_commitment_enabled: boolean;
  demand_commitment_keywords: string[];
  demand_commitment_verbs?: string[];
  reply_enabled: boolean;
  reply_sign_name: boolean;
  /** alerta de nova mensagem no centro da tela */
  msg_alert_enabled: boolean;
  /** 0 = fica até fechar; senão, segundos até fechar sozinho */
  msg_alert_auto_close: number;
  msg_alert_sound: boolean;
  /** fala o aviso em voz alta (português) */
  msg_alert_voice?: boolean;
  /** voz: fala as mensagens novas */
  msg_alert_voice_messages?: boolean;
  /** voz: fala o SLA excedido */
  msg_alert_voice_sla?: boolean;
  /** voz: frase de cada aviso ({"message","sla","alert"}; vazio = padrão) */
  msg_alert_voice_templates?: Record<string, string> | null;
  msg_alert_voice_name?: string | null;
  msg_alert_voice_rate?: number | string | null;
  msg_alert_voice_pitch?: number | string | null;
  /** alertas do sistema e SLA excedido também abrem no centro da tela */
  msg_alert_alerts: boolean;
  reply_allowed: 'all' | 'admin';
};

/** Resposta escrita no painel, na fila de envio do worker. */
export type OutgoingMessage = {
  id: string;
  group_id: string;
  body: string;
  text_to_send: string;
  quoted_message_id: string | null;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  error: string | null;
  wa_message_id: string | null;
  sender_name: string;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  /** áudio gravado no painel (0074) */
  message_type?: string;
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

export type DemandStatus = 'aberta' | 'em_andamento' | 'entregue' | 'cancelada';

export type Demand = {
  id: string;
  number: number;
  group_id: string;
  origin_message_id: string | null;
  description: string;
  type: string | null;
  assignee_id: string | null;
  status: DemandStatus;
  opened_at: string;
  promised_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  followups_count: number;
  reopened_count: number;
  source: 'manual' | 'keyword' | 'ai' | 'commitment';
  created_at: string;
  updated_at: string;
};

export type DemandEvent = {
  id: number;
  demand_id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  message_id: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

/** Permissões do usuário atual pelos setores (my_permissions no banco). */
export type MyPermissions = {
  admin: boolean;
  sectors: { id: string; name: string; can_reply: boolean; can_manage_demands: boolean; can_handle_alerts: boolean }[];
  reply_groups: string[];
  demand_groups: string[];
  alert_groups: string[];
};
