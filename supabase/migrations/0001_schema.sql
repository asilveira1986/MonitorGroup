-- =====================================================================
-- MonitorGroup - Monitor de grupos de WhatsApp
-- Esquema completo do banco (Supabase / PostgreSQL)
-- Execute no SQL Editor do Supabase ou via `supabase db push`.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Usuários do sistema
-- ---------------------------------------------------------------------
-- Lista de e-mails autorizados (pré-cadastro). Somente quem está aqui
-- consegue usar o sistema, seja por senha ou por login Google.
create table public.allowed_emails (
  email       text primary key check (email = lower(email)),
  role        text not null default 'agent' check (role in ('admin', 'agent')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        text not null default 'agent' check (role in ('admin', 'agent')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém entra pela primeira vez.
-- O primeiro usuário do sistema vira administrador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_allowed public.allowed_emails%rowtype;
  v_first   boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  select * into v_allowed from public.allowed_emails where email = lower(new.email);

  insert into public.profiles (id, email, full_name, avatar_url, role, active)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    case when v_first then 'admin' else coalesce(v_allowed.role, 'agent') end,
    v_first or v_allowed.email is not null
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Se um e-mail for autorizado depois que a pessoa já tentou entrar, ativa o perfil.
create or replace function public.handle_allowed_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set active = true, role = new.role where email = new.email;
  return new;
end;
$$;

create trigger on_allowed_email_upsert
  after insert or update on public.allowed_emails
  for each row execute function public.handle_allowed_email();

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Configurações gerais (linha única)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                    int primary key default 1 check (id = 1),
  company_name          text not null default 'Minha Empresa',
  timezone              text not null default 'America/Sao_Paulo',
  business_days         int[] not null default '{1,2,3,4,5}', -- 0=domingo ... 6=sábado
  business_start        time not null default '08:00',
  business_end          time not null default '18:00',
  default_sla_minutes   int not null default 30 check (default_sla_minutes > 0),
  auto_monitor_new_groups boolean not null default true,
  -- mensagens curtas como "ok", "obrigado", 👍 não abrem nova pendência
  ignore_acknowledgements boolean not null default true,
  updated_at            timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------
-- WhatsApp: instâncias (números conectados via QR code)
-- ---------------------------------------------------------------------
create table public.whatsapp_instances (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text,
  push_name        text,
  status           text not null default 'disconnected'
                   check (status in ('disconnected', 'connecting', 'qr', 'connected')),
  qr_code          text,
  qr_updated_at    timestamptz,
  requested_action text check (requested_action in ('connect', 'logout')),
  last_error       text,
  last_seen_at     timestamptz,
  connected_at     timestamptz,
  created_at       timestamptz not null default now()
);

-- Credenciais da sessão do WhatsApp (Baileys). Somente o worker acessa.
create table public.wa_auth_state (
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (instance_id, key)
);

-- ---------------------------------------------------------------------
-- Grupos monitorados
-- ---------------------------------------------------------------------
create table public.groups (
  id                     uuid primary key default gen_random_uuid(),
  instance_id            uuid not null references public.whatsapp_instances(id) on delete cascade,
  jid                    text not null,
  name                   text not null default 'Grupo sem nome',
  description            text,
  participants_count     int not null default 0,
  monitored              boolean not null default true,
  sla_minutes            int check (sla_minutes is null or sla_minutes > 0),
  -- Estado da conversa
  pending_since          timestamptz,           -- 1ª mensagem de cliente sem resposta
  pending_message_id     uuid,
  pending_count          int not null default 0, -- mensagens de cliente aguardando
  last_message_at        timestamptz,
  last_client_message_at timestamptz,
  last_team_message_at   timestamptz,
  last_message_preview   text,
  created_at             timestamptz not null default now(),
  unique (instance_id, jid)
);
create index groups_pending_idx on public.groups (pending_since) where pending_since is not null;

-- ---------------------------------------------------------------------
-- Equipe (quem responde os clientes). Mensagens enviadas pelo número
-- conectado contam sempre como equipe; aqui ficam os demais atendentes.
-- ---------------------------------------------------------------------
create table public.team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,   -- somente dígitos, com DDI. Ex.: 5511999998888
  jid         text,   -- identificador do WhatsApp (preenchido ao marcar pela conversa)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (phone is not null or jid is not null)
);
create unique index team_members_phone_idx on public.team_members (phone) where phone is not null;
create unique index team_members_jid_idx on public.team_members (jid) where jid is not null;

-- ---------------------------------------------------------------------
-- Mensagens
-- ---------------------------------------------------------------------
create table public.messages (
  id                     uuid primary key default gen_random_uuid(),
  group_id               uuid not null references public.groups(id) on delete cascade,
  wa_message_id          text not null,
  sender_jid             text,
  sender_phone           text,
  sender_name            text,
  from_me                boolean not null default false,
  from_team              boolean not null default false,
  team_member_id         uuid references public.team_members(id) on delete set null,
  message_type           text not null default 'text',
  body                   text,
  sent_at                timestamptz not null,
  -- Para mensagens da equipe que responderam um cliente pendente:
  response_time_seconds  int,
  answered_message_id    uuid references public.messages(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (group_id, wa_message_id)
);
create index messages_group_sent_idx on public.messages (group_id, sent_at desc);
create index messages_sent_idx on public.messages (sent_at desc);

alter table public.groups
  add constraint groups_pending_message_fk
  foreign key (pending_message_id) references public.messages(id) on delete set null;

-- ---------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------
create table public.alert_rules (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text not null check (type in ('no_response', 'keyword', 'high_volume', 'disconnected', 'inactivity')),
  severity            text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  active              boolean not null default true,
  -- Parâmetros (usados conforme o tipo)
  threshold_minutes   int,        -- no_response / inactivity / janela do high_volume
  threshold_count     int,        -- high_volume: nº de mensagens na janela
  keywords            text[],     -- keyword
  group_ids           uuid[],     -- null = todos os grupos monitorados
  business_hours_only boolean not null default false,
  cooldown_minutes    int not null default 60,
  -- Canais de notificação
  notify_in_app       boolean not null default true,
  notify_emails       text[] not null default '{}',
  notify_whatsapp     text[] not null default '{}', -- números (dígitos com DDI)
  notify_webhook_url  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.alerts (
  id               uuid primary key default gen_random_uuid(),
  rule_id          uuid references public.alert_rules(id) on delete set null,
  type             text not null,
  severity         text not null default 'warning',
  group_id         uuid references public.groups(id) on delete cascade,
  instance_id      uuid references public.whatsapp_instances(id) on delete cascade,
  message_id       uuid references public.messages(id) on delete set null,
  title            text not null,
  description      text,
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by  uuid references public.profiles(id) on delete set null,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  notified_channels text[] not null default '{}',
  created_at       timestamptz not null default now()
);
create index alerts_status_idx on public.alerts (status, created_at desc);
create index alerts_rule_group_idx on public.alerts (rule_id, group_id, created_at desc);

-- Regras padrão
insert into public.alert_rules (name, type, severity, threshold_minutes, business_hours_only)
values ('Cliente sem resposta há 30 min', 'no_response', 'warning', 30, true),
       ('Cliente sem resposta há 2 horas', 'no_response', 'critical', 120, false);
insert into public.alert_rules (name, type, severity, cooldown_minutes)
values ('WhatsApp desconectado', 'disconnected', 'critical', 30);
insert into public.alert_rules (name, type, severity, keywords, cooldown_minutes)
values ('Palavras críticas', 'keyword', 'critical',
        array['urgente', 'reclamação', 'cancelar', 'procon', 'absurdo'], 10);

-- ---------------------------------------------------------------------
-- Segurança (RLS)
-- ---------------------------------------------------------------------
alter table public.allowed_emails    enable row level security;
alter table public.profiles          enable row level security;
alter table public.app_settings      enable row level security;
alter table public.whatsapp_instances enable row level security;
alter table public.wa_auth_state     enable row level security;
alter table public.groups            enable row level security;
alter table public.team_members      enable row level security;
alter table public.messages          enable row level security;
alter table public.alert_rules       enable row level security;
alter table public.alerts            enable row level security;

-- Perfis: cada um vê o próprio; usuários ativos veem a equipe; admin gerencia
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_active_user());
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete
  using (public.is_admin() and id <> auth.uid());

create policy allowed_emails_admin on public.allowed_emails for all
  using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.app_settings for select using (public.is_active_user());
create policy settings_write on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

create policy instances_read on public.whatsapp_instances for select using (public.is_active_user());
create policy instances_write on public.whatsapp_instances for all
  using (public.is_admin()) with check (public.is_admin());

-- wa_auth_state: sem políticas => somente service_role (worker)

create policy groups_read on public.groups for select using (public.is_active_user());
create policy groups_update on public.groups for update
  using (public.is_active_user()) with check (public.is_active_user());

create policy team_read on public.team_members for select using (public.is_active_user());
create policy team_write on public.team_members for all
  using (public.is_active_user()) with check (public.is_active_user());

create policy messages_read on public.messages for select using (public.is_active_user());

create policy rules_read on public.alert_rules for select using (public.is_active_user());
create policy rules_write on public.alert_rules for all
  using (public.is_admin()) with check (public.is_admin());

create policy alerts_read on public.alerts for select using (public.is_active_user());
create policy alerts_update on public.alerts for update
  using (public.is_active_user()) with check (public.is_active_user());

-- ---------------------------------------------------------------------
-- Tempo real (QR code, novos alertas e mensagens na tela sem recarregar)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.whatsapp_instances;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.messages;
