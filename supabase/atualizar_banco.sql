-- =====================================================================
-- ATUALIZAÇÃO COMPLETA DO BANCO (gerado por supabase/build-updates.sh)
-- Junta os scripts 0002 em diante, na ordem. Pode ser executado mais de
-- uma vez: o que já existe é mantido e o que falta é criado.
-- Pré-requisito: 0001_schema.sql já executado (instalação inicial).
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>> 0002_metrics.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Funções de métricas para o dashboard
-- =====================================================================

create or replace function public.dashboard_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_group_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz      text;
  v_sla     int;
  v_result  jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select timezone, default_sla_minutes into v_tz, v_sla from public.app_settings where id = 1;

  with g as (
    select * from public.groups
    where monitored and (p_group_id is null or id = p_group_id)
  ),
  m as (
    select msg.*, coalesce(g.sla_minutes, v_sla) as sla_minutes
    from public.messages msg
    join g on g.id = msg.group_id
    where msg.sent_at >= p_from and msg.sent_at < p_to
  ),
  resp as (
    select * from m where from_team and response_time_seconds is not null
  ),
  kpis as (
    select
      (select count(*) from m where not from_team)                              as received,
      (select count(*) from m where from_team)                                  as sent,
      (select count(distinct group_id) from m)                                  as active_groups,
      (select count(*) from g)                                                  as monitored_groups,
      (select count(*) from g where pending_since is not null)                  as pending_groups,
      (select count(*) from g where pending_since is not null
         and pending_since < now() - make_interval(mins => coalesce(g.sla_minutes, v_sla))) as overdue_groups,
      (select min(pending_since) from g)                                        as oldest_pending,
      (select count(*) from resp)                                               as responses,
      (select round(avg(response_time_seconds)) from resp)                      as avg_response_seconds,
      (select percentile_cont(0.5) within group (order by response_time_seconds) from resp) as median_response_seconds,
      (select percentile_cont(0.9) within group (order by response_time_seconds) from resp) as p90_response_seconds,
      (select count(*) from resp where response_time_seconds <= sla_minutes * 60) as responses_in_sla,
      (select count(distinct sender_jid) from m where not from_team)            as unique_clients,
      (select count(*) from public.alerts a where a.status <> 'resolved'
         and (p_group_id is null or a.group_id = p_group_id))                   as open_alerts
  ),
  days as (
    select d::date as day
    from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d
  ),
  daily as (
    select
      days.day,
      count(m.id) filter (where not m.from_team) as received,
      count(m.id) filter (where m.from_team)     as sent,
      round(avg(m.response_time_seconds) filter (where m.from_team)) as avg_response_seconds,
      count(m.id) filter (where m.response_time_seconds is not null) as responses,
      count(m.id) filter (where m.response_time_seconds is not null and m.response_time_seconds <= m.sla_minutes * 60) as in_sla
    from days
    left join m on (m.sent_at at time zone v_tz)::date = days.day
    group by days.day
    order by days.day
  ),
  hourly as (
    select h as hour,
      (select count(*) from m where not from_team and extract(hour from sent_at at time zone v_tz) = h) as received,
      (select count(*) from m where from_team and extract(hour from sent_at at time zone v_tz) = h) as sent
    from generate_series(0, 23) h
  ),
  top_groups as (
    select g.id, g.name, g.pending_since, g.pending_count,
      count(m.id) filter (where not m.from_team) as received,
      count(m.id) filter (where m.from_team) as sent,
      round(avg(m.response_time_seconds)) as avg_response_seconds
    from g left join m on m.group_id = g.id
    group by g.id, g.name, g.pending_since, g.pending_count
    order by count(m.id) desc, g.name
    limit 10
  ),
  team as (
    select
      coalesce(tm.name, m.sender_name, case when m.from_me then 'Número conectado' end, m.sender_phone, 'Equipe') as name,
      count(*) as messages,
      count(*) filter (where m.response_time_seconds is not null) as responses,
      round(avg(m.response_time_seconds)) as avg_response_seconds
    from m
    left join public.team_members tm on tm.id = m.team_member_id
    where m.from_team
    group by 1
    order by responses desc, messages desc
    limit 10
  ),
  buckets as (
    select label, ord, count(r.id) as total
    from (values
      ('Até 5 min', 1, 0, 300),
      ('5–15 min', 2, 300, 900),
      ('15–30 min', 3, 900, 1800),
      ('30–60 min', 4, 1800, 3600),
      ('1–4 h', 5, 3600, 14400),
      ('Mais de 4 h', 6, 14400, 2147483647)
    ) b(label, ord, lo, hi)
    left join resp r on r.response_time_seconds >= b.lo and r.response_time_seconds < b.hi
    group by label, ord
    order by ord
  )
  select jsonb_build_object(
    'kpis',       (select to_jsonb(kpis) from kpis),
    'daily',      coalesce((select jsonb_agg(daily) from daily), '[]'::jsonb),
    'hourly',     coalesce((select jsonb_agg(hourly) from hourly), '[]'::jsonb),
    'top_groups', coalesce((select jsonb_agg(top_groups) from top_groups), '[]'::jsonb),
    'team',       coalesce((select jsonb_agg(team) from team), '[]'::jsonb),
    'buckets',    coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total)) from buckets), '[]'::jsonb),
    'timezone',   v_tz,
    'default_sla_minutes', v_sla
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.dashboard_metrics(timestamptz, timestamptz, uuid) to authenticated;

-- Fila de conversas aguardando resposta, ordenada pela mais antiga
create or replace view public.pending_queue
with (security_invoker = true)
as
select
  g.id,
  g.name,
  g.instance_id,
  g.pending_since,
  g.pending_count,
  g.last_message_preview,
  g.last_message_at,
  coalesce(g.sla_minutes, s.default_sla_minutes) as sla_minutes,
  extract(epoch from (now() - g.pending_since))::int as waiting_seconds,
  (now() - g.pending_since) > make_interval(mins => coalesce(g.sla_minutes, s.default_sla_minutes)) as overdue,
  pm.sender_name as pending_sender_name,
  pm.sender_phone as pending_sender_phone,
  pm.body as pending_body
from public.groups g
cross join public.app_settings s
left join public.messages pm on pm.id = g.pending_message_id
where g.monitored and g.pending_since is not null
order by g.pending_since asc;

grant select on public.pending_queue to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0003_ingest.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Registro atômico de mensagens + atualização do estado da conversa.
-- Usado somente pelo worker (service_role).
--
-- Regra de negócio:
--  * Mensagem de CLIENTE abre (ou incrementa) a pendência do grupo.
--  * Mensagem da EQUIPE fecha a pendência; o tempo de resposta é medido
--    desde a primeira mensagem do cliente que ficou sem resposta.
-- =====================================================================

create or replace function public.ingest_message(
  p_group_id       uuid,
  p_wa_message_id  text,
  p_sender_jid     text,
  p_sender_phone   text,
  p_sender_name    text,
  p_from_me        boolean,
  p_from_team      boolean,
  p_team_member_id uuid,
  p_message_type   text,
  p_body           text,
  p_sent_at        timestamptz,
  p_opens_pending  boolean default true -- false para "ok", "obrigado" etc.
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_group     public.groups%rowtype;
  v_msg_id    uuid;
  v_response  int;
  v_answered  uuid;
  v_is_latest boolean;
  v_preview   text;
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
  end if;

  -- mensagens antigas (sincronização de histórico) não alteram o estado atual
  v_is_latest := v_group.last_message_at is null or p_sent_at >= v_group.last_message_at;
  v_preview := left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160);

  if not v_is_latest then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'stale', true);
  end if;

  if p_from_team then
    if v_group.pending_since is not null then
      v_response := greatest(0, extract(epoch from (p_sent_at - v_group.pending_since))::int);
      v_answered := v_group.pending_message_id;
      update public.messages
         set response_time_seconds = v_response, answered_message_id = v_answered
       where id = v_msg_id;
    end if;

    update public.groups set
      pending_since = null,
      pending_message_id = null,
      pending_count = 0,
      last_message_at = p_sent_at,
      last_team_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;

    -- resolve automaticamente alertas de "sem resposta" do grupo
    if v_response is not null then
      update public.alerts set status = 'resolved', resolved_at = now()
       where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
    end if;
  elsif not p_opens_pending and v_group.pending_since is null then
    -- agradecimento/confirmação após a resposta: não exige nova resposta
    update public.groups set
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  else
    update public.groups set
      pending_since = coalesce(pending_since, p_sent_at),
      pending_message_id = coalesce(pending_message_id, v_msg_id),
      pending_count = pending_count + 1,
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'message_id', v_msg_id,
    'response_time_seconds', v_response,
    'answered_message_id', v_answered
  );
end;
$$;

revoke all on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean) to service_role;

-- Marcar manualmente uma conversa como respondida (ex.: respondida por telefone)
create or replace function public.mark_group_answered(p_group_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  update public.groups set pending_since = null, pending_message_id = null, pending_count = 0
   where id = p_group_id;
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
end;
$$;

grant execute on function public.mark_group_answered(uuid) to authenticated;

-- Reclassifica um remetente como membro da equipe e recalcula
-- as mensagens dele (não altera o histórico de tempos de resposta).
create or replace function public.mark_sender_as_team(p_sender_jid text, p_name text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  insert into public.team_members (name, jid, phone)
  values (p_name, p_sender_jid, nullif(p_phone, ''))
  on conflict (jid) where jid is not null do update set name = excluded.name, active = true
  returning id into v_id;

  update public.messages set from_team = true, team_member_id = v_id
   where sender_jid = p_sender_jid and not from_team;
  return v_id;
end;
$$;

grant execute on function public.mark_sender_as_team(text, text, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0004_profile_fallback.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Garante o perfil de usuários criados ANTES de o esquema existir
-- (ex.: usuário criado no painel do Supabase antes de rodar o 0001).
-- =====================================================================

-- Cria o perfil do usuário logado se ele ainda não existir,
-- seguindo as mesmas regras do cadastro automático.
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_user    auth.users%rowtype;
  v_allowed public.allowed_emails%rowtype;
  v_first   boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if found then
    return v_profile;
  end if;

  select * into v_user from auth.users where id = auth.uid();
  select not exists (select 1 from public.profiles where role = 'admin' and active) into v_first;
  select * into v_allowed from public.allowed_emails where email = lower(v_user.email);

  insert into public.profiles (id, email, full_name, avatar_url, role, active)
  values (
    v_user.id,
    lower(v_user.email),
    coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'),
    v_user.raw_user_meta_data->>'avatar_url',
    case when v_first then 'admin' else coalesce(v_allowed.role, 'agent') end,
    v_first or v_allowed.email is not null
  )
  -- várias requisições simultâneas podem chegar aqui ao mesmo tempo
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = auth.uid();
  return v_profile;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

-- Corrige quem já foi criado antes: se ainda não há nenhum administrador,
-- o usuário mais antigo vira administrador.
insert into public.profiles (id, email, full_name, avatar_url, role, active)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.raw_user_meta_data->>'avatar_url',
  'agent',
  exists (select 1 from public.allowed_emails a where a.email = lower(u.email))
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set role = 'admin', active = true
where id = (
    select p.id from public.profiles p join auth.users u on u.id = p.id
    order by u.created_at limit 1
  )
  and not exists (select 1 from public.profiles where role = 'admin' and active);

-- >>>>>>>>>>>>>>>>>>>> 0005_worker_status.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Sinal de vida do worker do WhatsApp, exibido no painel.
-- Permite saber se o worker está no ar e conectado ao banco.
-- =====================================================================

create table if not exists public.worker_status (
  id               text primary key default 'main',
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  version          text,
  whatsapp_version text,
  info             jsonb not null default '{}'
);

alter table public.worker_status enable row level security;

drop policy if exists worker_status_read on public.worker_status;
create policy worker_status_read on public.worker_status for select using (public.is_active_user());

-- >>>>>>>>>>>>>>>>>>>> 0006_removed_groups.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Grupos excluídos do WhatsApp.
--
-- Quando o número conectado sai/é removido de um grupo, ou o grupo é
-- apagado no celular, o worker marca o grupo como "excluído" (removed_at).
-- Ele sai das listas ativas, da fila de pendências e dos alertas, mas o
-- histórico continua disponível na aba "Excluídos". De lá o administrador
-- pode excluí-lo definitivamente. Se o número voltar ao grupo, ele é
-- reativado automaticamente.
-- =====================================================================

alter table public.groups add column if not exists removed_at timestamptz;
alter table public.groups add column if not exists removed_reason text;

create index if not exists groups_removed_idx on public.groups (removed_at) where removed_at is not null;

-- Marca o grupo como excluído do WhatsApp (usado pelo worker)
create or replace function public.mark_group_removed(p_group_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.groups set
    removed_at = coalesce(removed_at, now()),
    removed_reason = p_reason,
    pending_since = null,
    pending_message_id = null,
    pending_count = 0
  where id = p_group_id;

  -- ninguém mais consegue responder nesse grupo: encerra os alertas abertos
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = p_group_id and status <> 'resolved';
end;
$$;

revoke all on function public.mark_group_removed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_group_removed(uuid, text) to service_role;

-- Exclusão definitiva (somente administradores e somente grupos já
-- excluídos do WhatsApp). Apaga mensagens e alertas em cascata.
create or replace function public.delete_removed_groups(p_group_ids uuid[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem excluir grupos';
  end if;

  delete from public.groups where id = any(p_group_ids) and removed_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.delete_removed_groups(uuid[]) to authenticated;

-- Fila de pendências ignora grupos excluídos
create or replace view public.pending_queue
with (security_invoker = true)
as
select
  g.id,
  g.name,
  g.instance_id,
  g.pending_since,
  g.pending_count,
  g.last_message_preview,
  g.last_message_at,
  coalesce(g.sla_minutes, s.default_sla_minutes) as sla_minutes,
  extract(epoch from (now() - g.pending_since))::int as waiting_seconds,
  (now() - g.pending_since) > make_interval(mins => coalesce(g.sla_minutes, s.default_sla_minutes)) as overdue,
  pm.sender_name as pending_sender_name,
  pm.sender_phone as pending_sender_phone,
  pm.body as pending_body
from public.groups g
cross join public.app_settings s
left join public.messages pm on pm.id = g.pending_message_id
where g.monitored and g.removed_at is null and g.pending_since is not null
order by g.pending_since asc;

grant select on public.pending_queue to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0007_history_import.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Importação do histórico dos grupos.
--
-- Ao ler o QR code, o WhatsApp envia as mensagens recentes. O worker
-- importa as dos últimos N dias (configurável) em lotes e, no fim,
-- recalcula de uma vez os tempos de resposta e a situação de cada grupo.
-- =====================================================================

-- Quantos dias de histórico importar ao conectar (0 = não importar)
alter table public.app_settings
  add column if not exists history_import_days int not null default 30
  check (history_import_days in (0, 7, 30, 60, 90));

-- Progresso da importação, exibido no painel
alter table public.whatsapp_instances add column if not exists history_status text not null default 'idle'
  check (history_status in ('idle', 'importing', 'done'));
alter table public.whatsapp_instances add column if not exists history_imported int not null default 0;
alter table public.whatsapp_instances add column if not exists history_started_at timestamptz;
alter table public.whatsapp_instances add column if not exists history_finished_at timestamptz;

-- Novo comando do painel: reconectar para receber o histórico de novo
alter table public.whatsapp_instances drop constraint if exists whatsapp_instances_requested_action_check;
alter table public.whatsapp_instances add constraint whatsapp_instances_requested_action_check
  check (requested_action in ('connect', 'logout', 'reimport'));

-- Guarda se a mensagem do cliente exige resposta ("ok", "obrigado" não exigem),
-- para o recálculo do histórico seguir a mesma regra do tempo real.
alter table public.messages add column if not exists opens_pending boolean not null default true;

-- Mesma função de antes, agora gravando opens_pending
create or replace function public.ingest_message(
  p_group_id       uuid,
  p_wa_message_id  text,
  p_sender_jid     text,
  p_sender_phone   text,
  p_sender_name    text,
  p_from_me        boolean,
  p_from_team      boolean,
  p_team_member_id uuid,
  p_message_type   text,
  p_body           text,
  p_sent_at        timestamptz,
  p_opens_pending  boolean default true -- false para "ok", "obrigado" etc.
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_group     public.groups%rowtype;
  v_msg_id    uuid;
  v_response  int;
  v_answered  uuid;
  v_is_latest boolean;
  v_preview   text;
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at, opens_pending
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at,
    coalesce(p_opens_pending, true)
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
  end if;

  -- mensagens antigas (sincronização de histórico) não alteram o estado atual
  v_is_latest := v_group.last_message_at is null or p_sent_at >= v_group.last_message_at;
  v_preview := left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160);

  if not v_is_latest then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'stale', true);
  end if;

  if p_from_team then
    if v_group.pending_since is not null then
      v_response := greatest(0, extract(epoch from (p_sent_at - v_group.pending_since))::int);
      v_answered := v_group.pending_message_id;
      update public.messages
         set response_time_seconds = v_response, answered_message_id = v_answered
       where id = v_msg_id;
    end if;

    update public.groups set
      pending_since = null,
      pending_message_id = null,
      pending_count = 0,
      last_message_at = p_sent_at,
      last_team_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;

    -- resolve automaticamente alertas de "sem resposta" do grupo
    if v_response is not null then
      update public.alerts set status = 'resolved', resolved_at = now()
       where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
    end if;
  elsif not p_opens_pending and v_group.pending_since is null then
    -- agradecimento/confirmação após a resposta: não exige nova resposta
    update public.groups set
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  else
    update public.groups set
      pending_since = coalesce(pending_since, p_sent_at),
      pending_message_id = coalesce(pending_message_id, v_msg_id),
      pending_count = pending_count + 1,
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'message_id', v_msg_id,
    'response_time_seconds', v_response,
    'answered_message_id', v_answered
  );
end;
$$;

-- Recalcula, em ordem cronológica, os tempos de resposta e a situação atual
-- do grupo (usado após importar o histórico).
create or replace function public.rebuild_group_state(p_group_id uuid, p_live_since timestamptz default now())
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_msg             record;
  v_pending_since   timestamptz;
  v_pending_msg     uuid;
  v_pending_count   int := 0;
  v_last            record;
  v_last_client     timestamptz;
  v_last_team       timestamptz;
  v_resp            int;
  v_answered        uuid;
begin
  perform 1 from public.groups where id = p_group_id for update;

  for v_msg in
    select id, from_team, opens_pending, sent_at, response_time_seconds, answered_message_id
    from public.messages where group_id = p_group_id order by sent_at, created_at
  loop
    if v_msg.from_team then
      v_last_team := v_msg.sent_at;
      if v_pending_since is not null then
        v_resp := greatest(0, extract(epoch from (v_msg.sent_at - v_pending_since))::int);
        v_answered := v_pending_msg;
      else
        v_resp := null;
        v_answered := null;
      end if;
      if v_msg.response_time_seconds is distinct from v_resp or v_msg.answered_message_id is distinct from v_answered then
        update public.messages set response_time_seconds = v_resp, answered_message_id = v_answered where id = v_msg.id;
      end if;
      v_pending_since := null;
      v_pending_msg := null;
      v_pending_count := 0;
    else
      v_last_client := v_msg.sent_at;
      if v_msg.opens_pending or v_pending_since is not null then
        v_pending_since := coalesce(v_pending_since, v_msg.sent_at);
        v_pending_msg := coalesce(v_pending_msg, v_msg.id);
        v_pending_count := v_pending_count + 1;
      end if;
    end if;
  end loop;

  -- pendências antigas vindas do histórico (anteriores à conexão) provavelmente
  -- foram resolvidas por outro canal: só ficam na fila as das últimas 24 horas
  if v_pending_since is not null
     and v_pending_since < p_live_since
     and v_pending_since < now() - interval '24 hours' then
    -- recomeça a contagem pelas mensagens de cliente das últimas 24 horas (se houver)
    select min(sent_at), (array_agg(id order by sent_at))[1], count(*)
      into v_pending_since, v_pending_msg, v_pending_count
    from public.messages
    where group_id = p_group_id and not from_team and opens_pending
      and sent_at >= now() - interval '24 hours'
      and sent_at > coalesce(v_last_team, '-infinity'::timestamptz);
    if v_pending_count = 0 then
      v_pending_since := null;
      v_pending_msg := null;
    end if;
  end if;

  select sent_at, sender_name, body, message_type into v_last
  from public.messages where group_id = p_group_id order by sent_at desc, created_at desc limit 1;

  update public.groups set
    pending_since = v_pending_since,
    pending_message_id = v_pending_msg,
    pending_count = v_pending_count,
    last_message_at = v_last.sent_at,
    last_client_message_at = v_last_client,
    last_team_message_at = v_last_team,
    last_message_preview = case when v_last.sent_at is null then null
      else left(coalesce(v_last.sender_name || ': ', '') || coalesce(v_last.body, '[' || v_last.message_type || ']'), 160) end
  where id = p_group_id;
end;
$$;

revoke all on function public.rebuild_group_state(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rebuild_group_state(uuid, timestamptz) to service_role;

-- Indicadores da tela do grupo calculados no banco (em vez de baixar as mensagens)
create or replace function public.group_stats(p_group_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_sla    int;
  v_result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select coalesce(g.sla_minutes, s.default_sla_minutes) * 60 into v_sla
  from public.groups g cross join public.app_settings s
  where g.id = p_group_id;

  select jsonb_build_object(
    'received', count(*) filter (where not from_team),
    'sent', count(*) filter (where from_team),
    'responses', count(response_time_seconds),
    'avg_response_seconds', round(avg(response_time_seconds)),
    'in_sla', count(*) filter (where response_time_seconds <= v_sla),
    'sla_seconds', v_sla
  ) into v_result
  from public.messages
  where group_id = p_group_id and sent_at >= now() - make_interval(days => p_days);

  return v_result;
end;
$$;

grant execute on function public.group_stats(uuid, int) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> 0008_indicators.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Indicadores configuráveis (etapa 1): catálogo, auditoria e feriados.
--
-- Cada indicador é um registro em public.indicators e uma função de
-- cálculo public.ind_<chave>(filtros jsonb, parametros jsonb) que devolve
-- um JSON num formato padrão (visual + dados). Opcionalmente, a função
-- public.ind_<chave>_details(filtros, parametros) devolve a lista do que
-- compõe o número. O dashboard, os alertas e os relatórios só leem do
-- catálogo: para criar um indicador novo basta o registro e as funções.
--
-- Formatos devolvidos pelas funções de cálculo:
--   kpi     {visual, value, format, tone?, hint?, secondary?:[{label,value,format}], trend?:{format,data:[{x,value}]}}
--   table   {visual, columns:[{key,label,format?,align?}], rows:[{...}]}
--   series  {visual, format, series:[{key,label}], data:[{x,...}]}
--   bars    {visual, format, series:[{key,label}], data:[{label,...}]}
--   heatmap {visual, rows:[label], cols:[label], values:[[n]], value?, hint?}
-- Formatos de valor: number, duration (segundos), percent, percent_delta, datetime, text
-- =====================================================================

-- ---------------------------------------------------------------------
-- Feriados (usados nos indicadores de tempo)
-- ---------------------------------------------------------------------
create table if not exists public.holidays (
  day         date primary key,
  name        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.holidays enable row level security;
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays for select using (public.is_active_user());
drop policy if exists holidays_admin on public.holidays;
create policy holidays_admin on public.holidays for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table if not exists public.indicator_blocks (
  key          text primary key,
  name         text not null,
  description  text,
  position     int not null default 0,
  enabled      boolean not null default true,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create table if not exists public.indicators (
  key                    text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  block_key              text not null references public.indicator_blocks(key) on update cascade,
  name                   text not null,
  description            text,
  position               int not null default 0,
  visual                 text not null check (visual in ('kpi', 'table', 'series', 'bars', 'heatmap')),
  -- tamanho no dashboard: 1 = cartão, 2 = metade, 3 = largura total
  size                   int not null default 1 check (size between 1 and 3),
  enabled                boolean not null default true,
  supports_alert         boolean not null default false,
  alert_enabled          boolean not null default false,
  has_details            boolean not null default true,
  params                 jsonb not null default '{}',
  -- descrição dos parâmetros para a tela de configurações:
  -- [{key, label, type: int|tags|categories, unit?, min?, max?, help?}]
  param_schema           jsonb not null default '[]',
  default_enabled        boolean not null default true,
  default_alert_enabled  boolean not null default false,
  default_params         jsonb not null default '{}',
  updated_by             uuid references public.profiles(id) on delete set null,
  updated_at             timestamptz not null default now()
);

create index if not exists indicators_block_idx on public.indicators (block_key, position);

alter table public.indicator_blocks enable row level security;
alter table public.indicators enable row level security;

-- leitura para usuários ativos; escrita SOMENTE pelas funções abaixo (que conferem admin)
drop policy if exists indicator_blocks_read on public.indicator_blocks;
create policy indicator_blocks_read on public.indicator_blocks for select using (public.is_active_user());
drop policy if exists indicators_read on public.indicators;
create policy indicators_read on public.indicators for select using (public.is_active_user());

-- ---------------------------------------------------------------------
-- Auditoria de configurações (quem alterou o quê e quando)
-- ---------------------------------------------------------------------
create table if not exists public.config_audit (
  id              bigint generated always as identity primary key,
  table_name      text not null,
  record_key      text not null,
  changed_fields  text[] not null default '{}',
  old_values      jsonb,
  new_values      jsonb,
  changed_by      uuid references public.profiles(id) on delete set null,
  changed_at      timestamptz not null default now()
);

create index if not exists config_audit_record_idx on public.config_audit (table_name, record_key, changed_at desc);

alter table public.config_audit enable row level security;
drop policy if exists config_audit_admin on public.config_audit;
create policy config_audit_admin on public.config_audit for select using (public.is_admin());

create or replace function public.audit_config_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_key    text;
  v_fields text[];
  v_ignore text[] := array['updated_at', 'updated_by'];
begin
  v_key := coalesce(v_new->>'key', v_old->>'key', v_new->>'day', v_old->>'day', v_new->>'id', v_old->>'id');

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_fields
    from jsonb_object_keys(v_new) k
    where not (k = any(v_ignore)) and (v_new->k) is distinct from (v_old->k);
    if cardinality(v_fields) = 0 then
      return new;
    end if;
    select jsonb_object_agg(k, v_old->k) into v_old from unnest(v_fields) k;
    select jsonb_object_agg(k, v_new->k) into v_new from unnest(v_fields) k;
  else
    v_fields := array[lower(tg_op)];
  end if;

  insert into public.config_audit (table_name, record_key, changed_fields, old_values, new_values, changed_by)
  values (tg_table_name, coalesce(v_key, '?'), v_fields, v_old, v_new, auth.uid());

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_indicators on public.indicators;
create trigger audit_indicators after update on public.indicators
  for each row execute function public.audit_config_change();
drop trigger if exists audit_indicator_blocks on public.indicator_blocks;
create trigger audit_indicator_blocks after update on public.indicator_blocks
  for each row execute function public.audit_config_change();
drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings after update on public.app_settings
  for each row execute function public.audit_config_change();
drop trigger if exists audit_holidays on public.holidays;
create trigger audit_holidays after insert or delete on public.holidays
  for each row execute function public.audit_config_change();

-- ---------------------------------------------------------------------
-- Funções de administração do catálogo (somente admin)
-- ---------------------------------------------------------------------
create or replace function public.update_indicator(
  p_key           text,
  p_enabled       boolean default null,
  p_alert_enabled boolean default null,
  p_params        jsonb default null
)
returns public.indicators
language plpgsql security definer set search_path = public
as $$
declare
  v_ind    public.indicators%rowtype;
  v_params jsonb;
  v_field  jsonb;
  v_val    jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;

  select * into v_ind from public.indicators where key = p_key for update;
  if not found then
    raise exception 'Indicador % não encontrado', p_key;
  end if;

  v_params := v_ind.params;
  if p_params is not null then
    -- só aceita parâmetros descritos no param_schema, com validação de tipo e limites
    for v_field in select * from jsonb_array_elements(v_ind.param_schema) loop
      if p_params ? (v_field->>'key') then
        v_val := p_params->(v_field->>'key');
        if v_field->>'type' = 'int' then
          if jsonb_typeof(v_val) <> 'number' then
            raise exception 'Parâmetro "%" deve ser um número', v_field->>'label';
          end if;
          if v_field ? 'min' and (v_val)::numeric < (v_field->>'min')::numeric then
            raise exception 'Parâmetro "%" deve ser no mínimo %', v_field->>'label', v_field->>'min';
          end if;
          if v_field ? 'max' and (v_val)::numeric > (v_field->>'max')::numeric then
            raise exception 'Parâmetro "%" deve ser no máximo %', v_field->>'label', v_field->>'max';
          end if;
          v_val := to_jsonb(round((v_val)::numeric)::int);
        elsif v_field->>'type' = 'tags' then
          if jsonb_typeof(v_val) <> 'array' then
            raise exception 'Parâmetro "%" deve ser uma lista', v_field->>'label';
          end if;
        elsif v_field->>'type' = 'categories' then
          if jsonb_typeof(v_val) <> 'array' then
            raise exception 'Parâmetro "%" deve ser uma lista de categorias', v_field->>'label';
          end if;
        end if;
        v_params := v_params || jsonb_build_object(v_field->>'key', v_val);
      end if;
    end loop;
  end if;

  update public.indicators set
    enabled = coalesce(p_enabled, enabled),
    alert_enabled = case when supports_alert then coalesce(p_alert_enabled, alert_enabled) else false end,
    params = v_params,
    updated_by = auth.uid(),
    updated_at = now()
  where key = p_key
  returning * into v_ind;

  return v_ind;
end;
$$;

create or replace function public.set_indicator_block_enabled(p_block text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;
  update public.indicator_blocks set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
  where key = p_block;
  if not found then
    raise exception 'Bloco % não encontrado', p_block;
  end if;
end;
$$;

-- Restaura o padrão de um indicador (p_key) ou de todo o catálogo (p_key nulo)
create or replace function public.reset_indicators(p_key text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;
  update public.indicators set
    enabled = default_enabled,
    alert_enabled = default_alert_enabled,
    params = default_params,
    updated_by = auth.uid(),
    updated_at = now()
  where p_key is null or key = p_key;
  if p_key is null then
    update public.indicator_blocks set enabled = true, updated_by = auth.uid(), updated_at = now() where not enabled;
  end if;
end;
$$;

revoke all on function public.update_indicator(text, boolean, boolean, jsonb) from public, anon;
revoke all on function public.set_indicator_block_enabled(text, boolean) from public, anon;
revoke all on function public.reset_indicators(text) from public, anon;
grant execute on function public.update_indicator(text, boolean, boolean, jsonb) to authenticated;
grant execute on function public.set_indicator_block_enabled(text, boolean) to authenticated;
grant execute on function public.reset_indicators(text) to authenticated;

-- ---------------------------------------------------------------------
-- O SLA padrão tem uma fonte só: o parâmetro do indicador taxa_resposta_sla,
-- espelhado em app_settings.default_sla_minutes (usado na fila e nos alertas)
-- ---------------------------------------------------------------------
create or replace function public.sync_sla_setting()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.key = 'taxa_resposta_sla' and (new.params->>'sla_minutes') is not null
     and (new.params->'sla_minutes') is distinct from (old.params->'sla_minutes') then
    update public.app_settings set default_sla_minutes = (new.params->>'sla_minutes')::int, updated_at = now()
    where id = 1;
  end if;
  return new;
end;
$$;

drop trigger if exists indicators_sync_sla on public.indicators;
create trigger indicators_sync_sla after update on public.indicators
  for each row execute function public.sync_sla_setting();

-- ---------------------------------------------------------------------
-- Escopo comum: mensagens dos grupos monitorados no período/grupo filtrados
-- f = {from, to, group_id?, member_id?, tz}
-- ---------------------------------------------------------------------
create or replace function public.ind_scope(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, sender_name text, sender_phone text, from_me boolean,
  from_team boolean, team_member_id uuid, message_type text, body text, sent_at timestamptz,
  response_time_seconds int, answered_message_id uuid, sla_seconds int, opens_pending boolean
)
language sql stable set search_path = public
as $$
  select m.id, m.group_id, g.name, m.sender_name, m.sender_phone, m.from_me, m.from_team, m.team_member_id,
         m.message_type, m.body, m.sent_at, m.response_time_seconds, m.answered_message_id,
         coalesce(g.sla_minutes, s.default_sla_minutes) * 60, m.opens_pending
  from public.messages m
  join public.groups g on g.id = m.group_id
  cross join public.app_settings s
  where g.monitored
    and m.sent_at >= (f->>'from')::timestamptz
    and m.sent_at < (f->>'to')::timestamptz
    and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
$$;

-- Respostas da equipe no escopo (com a pergunta respondida), respeitando o filtro de atendente
-- (o script 0009 muda as colunas devolvidas: apaga antes para poder executar este script de novo)
drop function if exists public.ind_responses(jsonb);
create or replace function public.ind_responses(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, sla_seconds int, client_name text, question text, asked_at timestamptz
)
language sql stable set search_path = public
as $$
  select r.id, r.group_id, r.group_name,
         coalesce(tm.name, r.sender_name, case when r.from_me then 'Número conectado' end, 'Equipe'),
         r.team_member_id, r.sent_at, r.response_time_seconds, r.sla_seconds,
         coalesce(q.sender_name, q.sender_phone, 'Cliente'), q.body, q.sent_at
  from public.ind_scope(f) r
  left join public.team_members tm on tm.id = r.team_member_id
  left join public.messages q on q.id = r.answered_message_id
  where r.from_team and r.response_time_seconds is not null
    and ((f->>'member_id') is null or r.team_member_id = (f->>'member_id')::uuid)
$$;

-- colunas padrão da lista de respostas
create or replace function public.ind_responses_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Respondida em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'question', 'label', 'Mensagem do cliente'),
      jsonb_build_object('key', 'responder', 'label', 'Respondido por'),
      jsonb_build_object('key', 'response_time_seconds', 'label', 'Tempo', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'in_sla', 'label', 'No SLA', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'client_name', client_name,
      'question', left(coalesce(question, '[mídia]'), 200), 'responder', responder,
      'response_time_seconds', response_time_seconds,
      'in_sla', case when response_time_seconds <= sla_seconds then 'Sim' else 'Não' end
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_responses(f) order by sent_at desc limit 500) x
$$;

-- ---------------------------------------------------------------------
-- Indicadores (cálculo) — Bloco 1: Capacidade de resposta
-- ---------------------------------------------------------------------
create or replace function public.ind_tempo_primeira_resposta(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_responses(f)),
  agg as (
    select round(avg(response_time_seconds)) as avg_s,
           percentile_cont(0.5) within group (order by response_time_seconds) as med_s,
           percentile_cont(0.9) within group (order by response_time_seconds) as p90_s,
           count(*) as n
    from r
  ),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(avg(response_time_seconds)) as value
    from r group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'duration',
    'value', agg.avg_s,
    'hint', agg.n || ' resposta(s) no período',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Mediana', 'value', round(agg.med_s), 'format', 'duration'),
      jsonb_build_object('label', '90% em até', 'value', round(agg.p90_s), 'format', 'duration')
    ),
    'trend', jsonb_build_object('format', 'duration',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from agg
$$;

create or replace function public.ind_tempo_primeira_resposta_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_responses_details(f, p) $$;

create or replace function public.ind_mensagens_pendentes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with pend as (
    select g.id, g.pending_since,
           (now() - g.pending_since) > make_interval(mins => coalesce(g.sla_minutes, s.default_sla_minutes)) as overdue
    from public.groups g cross join public.app_settings s
    where g.monitored and g.removed_at is null and g.pending_since is not null
      and g.pending_since <= now() - make_interval(mins => coalesce((p->>'pending_after_minutes')::int, 0))
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', count(*),
    'tone', case when count(*) filter (where overdue) > 0 then 'critical' when count(*) > 0 then 'warning' else 'good' end,
    'hint', case when count(*) = 0 then 'Todos os clientes foram respondidos'
                 else count(*) filter (where overdue) || ' fora do SLA' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Espera mais longa', 'value', extract(epoch from now() - min(pending_since))::int, 'format', 'duration')
    )
  )
  from pend
$$;

create or replace function public.ind_mensagens_pendentes_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'body', 'label', 'Mensagem'),
      jsonb_build_object('key', 'pending_count', 'label', 'Msgs', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'waiting', 'label', 'Esperando há', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'overdue', 'label', 'Fora do SLA', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', id, 'group_name', name, 'client_name', client_name, 'body', left(coalesce(body, '[mídia]'), 200),
      'pending_count', pending_count, 'waiting', waiting, 'overdue', case when overdue then 'Sim' else 'Não' end
    ) order by waiting desc), '[]'::jsonb)
  )
  from (
    select q.id, q.name, q.pending_count, coalesce(q.pending_sender_name, q.pending_sender_phone, 'Cliente') as client_name,
           q.pending_body as body, q.waiting_seconds as waiting, q.overdue
    from public.pending_queue q
    where q.pending_since <= now() - make_interval(mins => coalesce((p->>'pending_after_minutes')::int, 0))
      and ((f->>'group_id') is null or q.id = (f->>'group_id')::uuid)
  ) x
$$;

create or replace function public.ind_taxa_resposta_sla(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_responses(f)),
  agg as (
    select count(*) as n, count(*) filter (where response_time_seconds <= sla_seconds) as ok from r
  ),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(100.0 * count(*) filter (where response_time_seconds <= sla_seconds) / count(*), 1) as value
    from r group by 1 order by 1
  ),
  v as (select case when n > 0 then round(100.0 * ok / n, 1) end as pct, n, ok from agg)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', v.pct,
    'tone', case when v.pct is null then null
                 when v.pct >= coalesce((p->>'target_percent')::numeric, 90) then 'good'
                 when v.pct >= coalesce((p->>'target_percent')::numeric, 90) - 15 then 'warning'
                 else 'critical' end,
    'hint', v.ok || ' de ' || v.n || ' respostas · SLA ' || coalesce(p->>'sla_minutes', '30') || ' min · meta ' || coalesce(p->>'target_percent', '90') || '%',
    'trend', jsonb_build_object('format', 'percent',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from v
$$;

create or replace function public.ind_taxa_resposta_sla_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_responses_details(f, p) $$;

create or replace function public.ind_respostas_por_atendente(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with team_msgs as (
    select s.*, coalesce(tm.name, s.sender_name, case when s.from_me then 'Número conectado' end, 'Equipe') as who
    from public.ind_scope(f) s
    left join public.team_members tm on tm.id = s.team_member_id
    where s.from_team and ((f->>'member_id') is null or s.team_member_id = (f->>'member_id')::uuid)
  ),
  agg as (
    select who,
           count(*) filter (where response_time_seconds is not null) as responses,
           count(*) as messages,
           round(avg(response_time_seconds)) as avg_s,
           round(100.0 * count(*) filter (where response_time_seconds <= sla_seconds)
                 / nullif(count(*) filter (where response_time_seconds is not null), 0), 1) as sla_pct
    from team_msgs group by who
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'who', 'label', 'Atendente'),
      jsonb_build_object('key', 'responses', 'label', 'Respostas a clientes', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'messages', 'label', 'Mensagens', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'avg_s', 'label', 'Tempo médio', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'sla_pct', 'label', 'No SLA', 'format', 'percent', 'align', 'right')
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(agg) order by responses desc, messages desc) from agg), '[]'::jsonb)
  )
$$;

create or replace function public.ind_respostas_por_atendente_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_responses_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Bloco 3: Saúde do relacionamento — volume por grupo
-- ---------------------------------------------------------------------
create or replace function public.ind_volume_por_grupo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with bounds as (
    select (f->>'from')::timestamptz as d0, (f->>'to')::timestamptz as d1,
           (f->>'to')::timestamptz - (f->>'from')::timestamptz as len
  ),
  prev as (
    select m.group_id, count(*) as total
    from public.messages m, bounds b
    where m.sent_at >= b.d0 - b.len and m.sent_at < b.d0
      and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    group by m.group_id
  ),
  cur as (
    select group_id, group_name,
           count(*) filter (where not from_team) as received,
           count(*) filter (where from_team) as sent,
           count(*) as total
    from public.ind_scope(f) group by group_id, group_name
  ),
  vr as (
    select c.group_id, c.group_name, c.received, c.sent, c.total, coalesce(pv.total, 0) as previous,
           case when coalesce(pv.total, 0) = 0 then null
                else round(100.0 * (c.total - pv.total) / pv.total, 1) end as variation
    from cur c left join prev pv on pv.group_id = c.group_id
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'received', 'label', 'Clientes', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'sent', 'label', 'Equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'total', 'label', 'Total', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'previous', 'label', 'Período anterior', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'variation', 'label', 'Variação', 'format', 'percent_delta', 'align', 'right',
        'highlight_abs_gte', coalesce((p->>'variation_percent')::numeric, 50))
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(vr) order by total desc) from vr), '[]'::jsonb)
  )
$$;

create or replace function public.ind_messages_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Data', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Remetente'),
      jsonb_build_object('key', 'side', 'label', 'Lado'),
      jsonb_build_object('key', 'body', 'label', 'Mensagem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name,
      'who', coalesce(sender_name, sender_phone, case when from_me then 'Número conectado' end, '—'),
      'side', case when from_team then 'Equipe' else 'Cliente' end,
      'body', left(coalesce(body, '[' || message_type || ']'), 200)
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_scope(f) order by sent_at desc limit 500) x
$$;

create or replace function public.ind_volume_por_grupo_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Bloco 4: Contexto operacional — horários de pico
-- ---------------------------------------------------------------------
create or replace function public.ind_horarios_pico(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with m as (
    select extract(dow from sent_at at time zone (f->>'tz'))::int as dow,
           extract(hour from sent_at at time zone (f->>'tz'))::int as hr
    from public.ind_scope(f) where not from_team
  ),
  grid as (
    select d, h, (select count(*) from m where m.dow = d and m.hr = h) as n
    from generate_series(0, 6) d, generate_series(0, 23) h
  ),
  peak as (select d, h, n from grid order by n desc limit 1)
  select jsonb_build_object(
    'visual', 'heatmap',
    'rows', '["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]'::jsonb,
    'cols', (select jsonb_agg(lpad(h::text, 2, '0') || 'h' order by h) from generate_series(0, 23) h),
    'values', (select jsonb_agg(r order by d) from (
      select d, jsonb_agg(n order by h) as r from grid group by d) x),
    'hint', (select case when n = 0 then 'Sem mensagens de clientes no período'
                         else 'Pico: ' || (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[d + 1]
                              || ' às ' || lpad(h::text, 2, '0') || 'h (' || n || ' mensagens)' end from peak)
  )
$$;

create or replace function public.ind_horarios_pico_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Despachantes: calculam os indicadores ATIVOS lidos do catálogo
-- ---------------------------------------------------------------------
create or replace function public.indicator_filters(
  p_from timestamptz, p_to timestamptz, p_group_id uuid, p_member_id uuid
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'group_id', p_group_id, 'member_id', p_member_id,
    'tz', s.timezone,
    'business_days', to_jsonb(s.business_days),
    'business_start', s.business_start, 'business_end', s.business_end,
    'holidays', coalesce((select jsonb_agg(day) from public.holidays), '[]'::jsonb)
  )
  from public.app_settings s where s.id = 1
$$;

revoke all on function public.indicator_filters(timestamptz, timestamptz, uuid, uuid) from public, anon;

create or replace function public.indicator_values(
  p_from timestamptz, p_to timestamptz, p_group_id uuid default null, p_member_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_f      jsonb;
  v_ind    record;
  v_data   jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  for v_ind in
    select i.*, b.name as block_name, b.position as block_position
    from public.indicators i join public.indicator_blocks b on b.key = i.block_key
    where i.enabled and b.enabled
    order by b.position, i.position
  loop
    begin
      execute format('select public.%I($1, $2)', 'ind_' || v_ind.key) into v_data using v_f, v_ind.params;
    exception when others then
      v_data := jsonb_build_object('visual', 'error', 'message', sqlerrm);
    end;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'key', v_ind.key, 'name', v_ind.name, 'description', v_ind.description,
      'block_key', v_ind.block_key, 'block_name', v_ind.block_name,
      'size', v_ind.size, 'has_details', v_ind.has_details, 'data', v_data
    ));
  end loop;

  return v_result;
end;
$$;

create or replace function public.indicator_details(
  p_key text, p_from timestamptz, p_to timestamptz, p_group_id uuid default null, p_member_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ind  public.indicators%rowtype;
  v_data jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select i.* into v_ind from public.indicators i join public.indicator_blocks b on b.key = i.block_key
  where i.key = p_key and i.enabled and b.enabled and i.has_details;
  if not found then
    raise exception 'Indicador indisponível';
  end if;
  execute format('select public.%I($1, $2)', 'ind_' || v_ind.key || '_details')
    into v_data using public.indicator_filters(p_from, p_to, p_group_id, p_member_id), v_ind.params;
  return v_data;
end;
$$;

grant execute on function public.indicator_values(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.indicator_details(text, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- as funções de cálculo só são chamadas pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'ind\_%' escape '\')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Tempo real: mudanças no catálogo chegam na hora às telas abertas
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.indicators; exception when others then null; end;
  begin alter publication supabase_realtime add table public.indicator_blocks; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Catálogo inicial (os demais indicadores entram nas próximas etapas)
-- ---------------------------------------------------------------------
insert into public.indicator_blocks (key, name, description, position) values
  ('capacidade_resposta', 'Capacidade de resposta', 'Se os clientes estão sendo respondidos e com que rapidez.', 1),
  ('entregas_demandas', 'Entregas e demandas', 'Se o que foi pedido está sendo entregue no prazo.', 2),
  ('saude_relacionamento', 'Saúde do relacionamento', 'Movimento dos grupos, silêncios e sinais de insatisfação.', 3),
  ('contexto_operacional', 'Contexto operacional', 'Quando e sobre o que os clientes falam.', 4)
on conflict (key) do nothing;

insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('tempo_primeira_resposta', 'capacidade_resposta', 'Tempo de primeira resposta',
   'Tempo entre a mensagem do cliente e a primeira resposta da equipe.', 1, 'kpi', 1, false, false,
   '{}', '[]'),
  ('mensagens_pendentes', 'capacidade_resposta', 'Mensagens pendentes',
   'Grupos com cliente sem resposta agora e há quanto tempo cada um espera.', 2, 'kpi', 1, true, true,
   '{"pending_after_minutes": 5}',
   '[{"key":"pending_after_minutes","label":"Considerar pendente após","type":"int","unit":"min","min":0,"max":1440,"help":"Mensagens mais recentes que isso ainda não contam como pendentes."}]'),
  ('taxa_resposta_sla', 'capacidade_resposta', 'Respondidas dentro do SLA',
   'Percentual de mensagens de clientes respondidas dentro do prazo.', 3, 'kpi', 1, false, false,
   '{"sla_minutes": 30, "target_percent": 90}',
   '[{"key":"sla_minutes","label":"SLA padrão","type":"int","unit":"min","min":1,"max":10080,"help":"Prazo de resposta. Grupos podem ter SLA próprio."},{"key":"target_percent","label":"Meta","type":"int","unit":"%","min":1,"max":100}]'),
  ('respostas_por_atendente', 'capacidade_resposta', 'Respostas por atendente',
   'Quantas respostas cada membro da equipe deu no período e em quanto tempo.', 4, 'table', 2, false, false,
   '{}', '[]'),
  ('volume_por_grupo', 'saude_relacionamento', 'Volume por grupo',
   'Mensagens por grupo comparadas ao período anterior, destacando picos e quedas.', 1, 'table', 2, true, false,
   '{"variation_percent": 50}',
   '[{"key":"variation_percent","label":"Destacar variação a partir de","type":"int","unit":"%","min":1,"max":1000}]'),
  ('horarios_pico', 'contexto_operacional', 'Horários de pico',
   'Mensagens de clientes por dia da semana e hora.', 1, 'heatmap', 3, false, false,
   '{}', '[]')
on conflict (key) do nothing;

-- valores atuais = padrão (SLA atual da empresa vira o parâmetro do indicador)
update public.indicators set
  params = case when key = 'taxa_resposta_sla'
                then default_params || jsonb_build_object('sla_minutes', (select default_sla_minutes from public.app_settings where id = 1))
                else default_params end,
  enabled = default_enabled,
  alert_enabled = default_alert_enabled
where updated_by is null and params = '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Regras de alerta passam a seguir o indicador correspondente
-- ---------------------------------------------------------------------
alter table public.alert_rules add column if not exists indicator_key text references public.indicators(key) on delete set null;
update public.alert_rules set indicator_key = case type
    when 'no_response' then 'mensagens_pendentes'
    when 'high_volume' then 'volume_por_grupo'
  end
where indicator_key is null and type in ('no_response', 'high_volume');

-- >>>>>>>>>>>>>>>>>>>> 0009_response_block.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Indicadores (etapa 2): Bloco 1 — Capacidade de resposta completo.
--
-- * Tempo útil: só conta o horário comercial (dias úteis, início/fim do
--   expediente) e desconta os feriados. Usado no SLA e nos tempos.
-- * Tempo de primeira resposta separado para mensagens que chegaram dentro
--   e fora do horário comercial.
-- * Pendentes listadas mensagem a mensagem, com o tempo de espera.
-- =====================================================================

-- Instante dentro do horário comercial? (f traz tz, business_days, business_start/end e holidays)
create or replace function public.is_business_time(p_ts timestamptz, f jsonb)
returns boolean
language sql stable set search_path = public
as $$
  select extract(dow from (p_ts at time zone (f->>'tz')))::int in (select jsonb_array_elements_text(f->'business_days')::int)
     and not ((p_ts at time zone (f->>'tz'))::date::text in (select jsonb_array_elements_text(f->'holidays')))
     and (p_ts at time zone (f->>'tz'))::time >= (f->>'business_start')::time
     and (p_ts at time zone (f->>'tz'))::time < (f->>'business_end')::time
$$;

-- Segundos de horário comercial entre dois instantes (tempo útil)
create or replace function public.business_seconds(p_from timestamptz, p_to timestamptz, f jsonb)
returns int
language sql stable set search_path = public
as $$
  select case when p_to is null or p_from is null or p_to <= p_from then 0 else
    coalesce(sum(greatest(0, extract(epoch from
      least(p_to, ((d::date + (f->>'business_end')::time) at time zone (f->>'tz')))
      - greatest(p_from, ((d::date + (f->>'business_start')::time) at time zone (f->>'tz')))
    ))), 0)::int end
  from generate_series(
    (p_from at time zone (f->>'tz'))::date,
    -- limite de segurança: no máximo 120 dias de cálculo por intervalo
    least((p_to at time zone (f->>'tz'))::date, (p_from at time zone (f->>'tz'))::date + 120),
    interval '1 day'
  ) d
  where extract(dow from d)::int in (select jsonb_array_elements_text(f->'business_days')::int)
    and d::date::text not in (select jsonb_array_elements_text(f->'holidays'))
$$;

-- O SLA conta só o horário comercial? (parâmetro do indicador taxa_resposta_sla)
create or replace function public.sla_business_time_only()
returns boolean
language sql stable set search_path = public
as $$
  select coalesce((select (params->>'business_time_only')::boolean from public.indicators where key = 'taxa_resposta_sla'), true)
$$;

-- Respostas: agora com tempo útil e se a pergunta chegou no expediente
drop function if exists public.ind_responses(jsonb);
create function public.ind_responses(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
  asked_at timestamptz, asked_in_business boolean
)
language sql stable set search_path = public
as $$
  select r.id, r.group_id, r.group_name,
         coalesce(tm.name, r.sender_name, case when r.from_me then 'Número conectado' end, 'Equipe'),
         r.team_member_id, r.sent_at, r.response_time_seconds,
         public.business_seconds(r.sent_at - make_interval(secs => r.response_time_seconds), r.sent_at, f),
         r.sla_seconds,
         coalesce(q.sender_name, q.sender_phone, 'Cliente'), q.body,
         r.sent_at - make_interval(secs => r.response_time_seconds),
         public.is_business_time(r.sent_at - make_interval(secs => r.response_time_seconds), f)
  from public.ind_scope(f) r
  left join public.team_members tm on tm.id = r.team_member_id
  left join public.messages q on q.id = r.answered_message_id
  where r.from_team and r.response_time_seconds is not null
    and ((f->>'member_id') is null or r.team_member_id = (f->>'member_id')::uuid)
$$;

create or replace function public.ind_responses_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with o as (select public.sla_business_time_only() as useful)
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'asked_at', 'label', 'Cliente escreveu', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'question', 'label', 'Mensagem do cliente'),
      jsonb_build_object('key', 'responder', 'label', 'Respondido por'),
      jsonb_build_object('key', 'shift', 'label', 'Chegou', 'format', 'text'),
      jsonb_build_object('key', 'response_time_seconds', 'label', 'Tempo corrido', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'business_seconds', 'label', 'Tempo útil', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'in_sla', 'label', 'No SLA', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'asked_at', asked_at, 'group_id', group_id, 'group_name', group_name, 'client_name', client_name,
      'question', left(coalesce(question, '[mídia]'), 200), 'responder', responder,
      'shift', case when asked_in_business then 'No expediente' else 'Fora do expediente' end,
      'response_time_seconds', response_time_seconds, 'business_seconds', business_seconds,
      'in_sla', case when (case when o.useful then business_seconds else response_time_seconds end) <= sla_seconds
                     then 'Sim' else 'Não' end
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_responses(f) order by sent_at desc limit 500) x, o
$$;

-- ---------------------------------------------------------------------
-- tempo_primeira_resposta: geral + dentro e fora do horário comercial
-- ---------------------------------------------------------------------
create or replace function public.ind_tempo_primeira_resposta(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_responses(f)),
  agg as (
    select round(avg(response_time_seconds)) as avg_s,
           percentile_cont(0.5) within group (order by response_time_seconds) as med_s,
           round(avg(response_time_seconds) filter (where asked_in_business)) as in_s,
           count(*) filter (where asked_in_business) as in_n,
           round(avg(response_time_seconds) filter (where not asked_in_business)) as out_s,
           count(*) filter (where not asked_in_business) as out_n,
           count(*) as n
    from r
  ),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(avg(response_time_seconds) filter (where asked_in_business)) as value
    from r group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'duration',
    'value', agg.in_s,
    'hint', 'Média no horário comercial · ' || agg.in_n || ' de ' || agg.n || ' respostas',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Fora do expediente', 'value', agg.out_s, 'format', 'duration'),
      jsonb_build_object('label', 'Geral', 'value', agg.avg_s, 'format', 'duration'),
      jsonb_build_object('label', 'Mediana', 'value', round(agg.med_s), 'format', 'duration')
    ),
    'trend', jsonb_build_object('format', 'duration',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from agg
$$;

-- ---------------------------------------------------------------------
-- taxa_resposta_sla: SLA medido em tempo útil (configurável)
-- ---------------------------------------------------------------------
create or replace function public.ind_taxa_resposta_sla(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (
    select *, case when coalesce((p->>'business_time_only')::boolean, true) then business_seconds
                   else response_time_seconds end as t
    from public.ind_responses(f)
  ),
  agg as (select count(*) as n, count(*) filter (where t <= sla_seconds) as ok from r),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(100.0 * count(*) filter (where t <= sla_seconds) / count(*), 1) as value
    from r group by 1 order by 1
  ),
  v as (select case when n > 0 then round(100.0 * ok / n, 1) end as pct, n, ok from agg)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', v.pct,
    'tone', case when v.pct is null then null
                 when v.pct >= coalesce((p->>'target_percent')::numeric, 90) then 'good'
                 when v.pct >= coalesce((p->>'target_percent')::numeric, 90) - 15 then 'warning'
                 else 'critical' end,
    'hint', v.ok || ' de ' || v.n || ' respostas · SLA ' || coalesce(p->>'sla_minutes', '30') || ' min'
            || case when coalesce((p->>'business_time_only')::boolean, true) then ' úteis' else ' corridos' end
            || ' · meta ' || coalesce(p->>'target_percent', '90') || '%',
    'trend', jsonb_build_object('format', 'percent',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from v
$$;

-- ---------------------------------------------------------------------
-- respostas_por_atendente: com SLA no mesmo critério
-- ---------------------------------------------------------------------
create or replace function public.ind_respostas_por_atendente(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with useful as (select public.sla_business_time_only() as on_),
  team_msgs as (
    select coalesce(tm.name, s.sender_name, case when s.from_me then 'Número conectado' end, 'Equipe') as who, count(*) as messages
    from public.ind_scope(f) s
    left join public.team_members tm on tm.id = s.team_member_id
    where s.from_team and ((f->>'member_id') is null or s.team_member_id = (f->>'member_id')::uuid)
    group by 1
  ),
  resp as (
    select responder as who, count(*) as responses, round(avg(response_time_seconds)) as avg_s,
           round(avg(response_time_seconds) filter (where asked_in_business)) as avg_in_s,
           round(100.0 * count(*) filter (where (case when u.on_ then business_seconds else response_time_seconds end) <= sla_seconds)
                 / count(*), 1) as sla_pct
    from public.ind_responses(f), useful u group by responder
  ),
  agg as (
    select t.who, coalesce(r.responses, 0) as responses, t.messages, r.avg_s, r.avg_in_s, r.sla_pct
    from team_msgs t left join resp r on r.who = t.who
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'who', 'label', 'Atendente'),
      jsonb_build_object('key', 'responses', 'label', 'Respostas a clientes', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'messages', 'label', 'Mensagens', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'avg_in_s', 'label', 'Tempo médio (expediente)', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'sla_pct', 'label', 'No SLA', 'format', 'percent', 'align', 'right')
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(agg) order by responses desc, messages desc) from agg), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- mensagens_pendentes: SLA no mesmo critério e lista mensagem a mensagem
-- ---------------------------------------------------------------------
create or replace function public.ind_pending_messages(f jsonb, p jsonb)
returns table (
  message_id uuid, group_id uuid, group_name text, client_name text, body text, message_type text,
  sent_at timestamptz, waiting_seconds int, waiting_business_seconds int, sla_seconds int, overdue boolean
)
language sql stable set search_path = public
as $$
  with g as (
    select g.*, coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s
    from public.groups g cross join public.app_settings s
    where g.monitored and g.removed_at is null and g.pending_since is not null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
  ),
  m as (
    select m.id, g.id as group_id, g.name, coalesce(m.sender_name, m.sender_phone, 'Cliente') as client_name,
           m.body, m.message_type, m.sent_at, g.sla_s,
           extract(epoch from now() - m.sent_at)::int as waiting,
           public.business_seconds(m.sent_at, now(), f) as waiting_b
    from g join public.messages m on m.group_id = g.id and not m.from_team and m.sent_at >= g.pending_since
  )
  select id, group_id, name, client_name, body, message_type, sent_at, waiting, waiting_b, sla_s,
         (case when public.sla_business_time_only() then waiting_b else waiting end) > sla_s
  from m
  where waiting >= coalesce((p->>'pending_after_minutes')::int, 0) * 60
$$;

create or replace function public.ind_mensagens_pendentes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with pm as (select * from public.ind_pending_messages(f, p)),
  agg as (
    select count(*) as n, count(distinct group_id) as groups, count(*) filter (where overdue) as late,
           max(waiting_seconds) as longest
    from pm
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'tone', case when late > 0 then 'critical' when n > 0 then 'warning' else 'good' end,
    'hint', case when n = 0 then 'Todos os clientes foram respondidos'
                 else 'em ' || groups || ' grupo(s) · ' || late || ' fora do SLA' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Espera mais longa', 'value', longest, 'format', 'duration')
    )
  )
  from agg
$$;

create or replace function public.ind_mensagens_pendentes_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Enviada em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'body', 'label', 'Mensagem'),
      jsonb_build_object('key', 'waiting_seconds', 'label', 'Esperando há', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'waiting_business_seconds', 'label', 'Tempo útil', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'overdue', 'label', 'Fora do SLA', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'client_name', client_name,
      'body', left(coalesce(body, '[' || message_type || ']'), 200),
      'waiting_seconds', waiting_seconds, 'waiting_business_seconds', waiting_business_seconds,
      'overdue', case when overdue then 'Sim' else 'Não' end
    ) order by waiting_seconds desc), '[]'::jsonb)
  )
  from public.ind_pending_messages(f, p)
$$;

-- ---------------------------------------------------------------------
-- Parâmetros: novo tipo "bool" e editor do horário comercial
-- ---------------------------------------------------------------------
create or replace function public.update_indicator(
  p_key           text,
  p_enabled       boolean default null,
  p_alert_enabled boolean default null,
  p_params        jsonb default null
)
returns public.indicators
language plpgsql security definer set search_path = public
as $$
declare
  v_ind    public.indicators%rowtype;
  v_params jsonb;
  v_field  jsonb;
  v_val    jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;

  select * into v_ind from public.indicators where key = p_key for update;
  if not found then
    raise exception 'Indicador % não encontrado', p_key;
  end if;

  v_params := v_ind.params;
  if p_params is not null then
    -- só aceita parâmetros descritos no param_schema, com validação de tipo e limites
    for v_field in select * from jsonb_array_elements(v_ind.param_schema) loop
      if p_params ? (v_field->>'key') then
        v_val := p_params->(v_field->>'key');
        if v_field->>'type' = 'int' then
          if jsonb_typeof(v_val) <> 'number' then
            raise exception 'Parâmetro "%" deve ser um número', v_field->>'label';
          end if;
          if v_field ? 'min' and (v_val)::numeric < (v_field->>'min')::numeric then
            raise exception 'Parâmetro "%" deve ser no mínimo %', v_field->>'label', v_field->>'min';
          end if;
          if v_field ? 'max' and (v_val)::numeric > (v_field->>'max')::numeric then
            raise exception 'Parâmetro "%" deve ser no máximo %', v_field->>'label', v_field->>'max';
          end if;
          v_val := to_jsonb(round((v_val)::numeric)::int);
        elsif v_field->>'type' = 'bool' then
          if jsonb_typeof(v_val) <> 'boolean' then
            raise exception 'Parâmetro "%" deve ser sim/não', v_field->>'label';
          end if;
        elsif v_field->>'type' = 'tags' then
          if jsonb_typeof(v_val) <> 'array' then
            raise exception 'Parâmetro "%" deve ser uma lista', v_field->>'label';
          end if;
        elsif v_field->>'type' = 'categories' then
          if jsonb_typeof(v_val) <> 'array' then
            raise exception 'Parâmetro "%" deve ser uma lista de categorias', v_field->>'label';
          end if;
        end if;
        v_params := v_params || jsonb_build_object(v_field->>'key', v_val);
      end if;
    end loop;
  end if;

  update public.indicators set
    enabled = coalesce(p_enabled, enabled),
    alert_enabled = case when supports_alert then coalesce(p_alert_enabled, alert_enabled) else false end,
    params = v_params,
    updated_by = auth.uid(),
    updated_at = now()
  where key = p_key
  returning * into v_ind;

  return v_ind;
end;
$$;

update public.indicators set
  param_schema = '[{"key":"business_hours","label":"Horário comercial e dias úteis","type":"business_hours","help":"Mesmo cadastro de Configurações › Geral, usado em todos os indicadores de tempo. Feriados também são descontados."}]'
where key = 'tempo_primeira_resposta';

update public.indicators set
  default_params = default_params || '{"business_time_only": true}',
  params = params || jsonb_build_object('business_time_only', coalesce((params->>'business_time_only')::boolean, true)),
  param_schema = '[{"key":"sla_minutes","label":"SLA padrão","type":"int","unit":"min","min":1,"max":10080,"help":"Prazo de resposta. Grupos podem ter SLA próprio."},{"key":"target_percent","label":"Meta","type":"int","unit":"%","min":1,"max":100},{"key":"business_time_only","label":"Contar só o horário comercial","type":"bool","help":"Ex.: mensagem às 22h respondida às 8h05 do dia útil seguinte conta 5 minutos."}]'
where key = 'taxa_resposta_sla';

update public.indicators set
  description = 'Mensagens de clientes sem resposta agora, com o tempo de espera de cada uma.'
where key = 'mensagens_pendentes';

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'ind\_%' escape '\' or p.proname in ('business_seconds', 'is_business_time', 'sla_business_time_only'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- horário comercial e feriados também atualizam as telas abertas na hora
do $$
begin
  begin alter publication supabase_realtime add table public.app_settings; exception when others then null; end;
  begin alter publication supabase_realtime add table public.holidays; exception when others then null; end;
end $$;

-- >>>>>>>>>>>>>>>>>>>> 0010_demands.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Indicadores (etapa 3): Demandas e Bloco 2 — Entregas e demandas.
--
-- Uma demanda nasce de 3 formas (cada uma ativável em Configurações):
--   * manual  — "Criar demanda" na conversa ou na tela de Demandas
--   * keyword — comando na mensagem (#demanda, #andamento, #entregue,
--               #cancelada, #prazo) ou palavra-chave do cliente
--   * ai      — classificação automática por IA (desligada por padrão)
-- Toda mudança vira um evento na linha do tempo (demand_events).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações das origens de demanda
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists demand_manual_enabled boolean not null default true;
alter table public.app_settings add column if not exists demand_command_enabled boolean not null default true;
alter table public.app_settings add column if not exists demand_keyword_enabled boolean not null default false;
alter table public.app_settings add column if not exists demand_keywords text[] not null
  default array['solicito', 'preciso de', 'gostaria de solicitar', 'podem enviar', 'favor enviar', 'orçamento'];
alter table public.app_settings add column if not exists demand_ai_enabled boolean not null default false;

-- ---------------------------------------------------------------------
-- Demandas
-- ---------------------------------------------------------------------
create table if not exists public.demands (
  id                      uuid primary key default gen_random_uuid(),
  number                  bigint generated always as identity unique,
  group_id                uuid not null references public.groups(id) on delete cascade,
  origin_message_id       uuid references public.messages(id) on delete set null,
  description             text not null,
  type                    text,
  assignee_id             uuid references public.team_members(id) on delete set null,
  status                  text not null default 'aberta'
                          check (status in ('aberta', 'em_andamento', 'entregue', 'cancelada')),
  opened_at               timestamptz not null default now(),
  promised_at             timestamptz,
  delivered_at            timestamptz,
  confirmed_at            timestamptz,
  confirmation_message_id uuid references public.messages(id) on delete set null,
  followups_count         int not null default 0,
  reopened_count          int not null default 0,
  source                  text not null default 'manual' check (source in ('manual', 'keyword', 'ai')),
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists demands_group_idx on public.demands (group_id, opened_at desc);
create index if not exists demands_status_idx on public.demands (status, opened_at desc);
create index if not exists demands_promised_idx on public.demands (promised_at) where status in ('aberta', 'em_andamento');
create unique index if not exists demands_origin_idx on public.demands (origin_message_id) where origin_message_id is not null;

create table if not exists public.demand_events (
  id           bigint generated always as identity primary key,
  demand_id    uuid not null references public.demands(id) on delete cascade,
  kind         text not null check (kind in ('created', 'status', 'assigned', 'promised', 'edited',
                                             'followup', 'reopened', 'confirmed', 'unconfirmed')),
  from_value   text,
  to_value     text,
  message_id   uuid references public.messages(id) on delete set null,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_label  text,
  created_at   timestamptz not null default now()
);
create index if not exists demand_events_demand_idx on public.demand_events (demand_id, created_at);

-- mensagem ligada a uma demanda (origem, cobrança, entrega, confirmação)
alter table public.messages add column if not exists demand_id uuid references public.demands(id) on delete set null;
create index if not exists messages_demand_idx on public.messages (demand_id) where demand_id is not null;

alter table public.demands enable row level security;
alter table public.demand_events enable row level security;

-- leitura para usuários ativos; escrita só pelas funções abaixo
drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select using (public.is_active_user());
drop policy if exists demand_events_read on public.demand_events;
create policy demand_events_read on public.demand_events for select using (public.is_active_user());

do $$
begin
  begin alter publication supabase_realtime add table public.demands; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Funções (painel: usuário ativo; worker: service_role)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_demands()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_active_user() or coalesce(auth.role(), '') = 'service_role' $$;

create or replace function public.demand_event(
  p_demand uuid, p_kind text, p_from text, p_to text, p_message uuid, p_actor text
) returns void
language sql security definer set search_path = public
as $$
  insert into public.demand_events (demand_id, kind, from_value, to_value, message_id, actor_id, actor_label)
  values (p_demand, p_kind, p_from, p_to, p_message, auth.uid(), p_actor)
$$;

create or replace function public.create_demand(
  p_group_id    uuid,
  p_description text,
  p_message_id  uuid default null,
  p_type        text default null,
  p_assignee_id uuid default null,
  p_promised_at timestamptz default null,
  p_source      text default 'manual',
  p_actor       text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare
  v_d      public.demands%rowtype;
  v_opened timestamptz;
  v_set    public.app_settings%rowtype;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.app_settings where id = 1;
  if p_source = 'manual' and not v_set.demand_manual_enabled then
    raise exception 'A criação manual de demandas está desativada nas configurações';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Informe a descrição da demanda';
  end if;

  -- mensagem que já originou uma demanda devolve a existente
  if p_message_id is not null then
    select * into v_d from public.demands where origin_message_id = p_message_id;
    if found then return v_d; end if;
    select sent_at into v_opened from public.messages where id = p_message_id and group_id = p_group_id;
  end if;

  insert into public.demands (group_id, origin_message_id, description, type, assignee_id, promised_at,
                              source, opened_at, created_by)
  values (p_group_id, p_message_id, left(trim(p_description), 1000), nullif(trim(p_type), ''), p_assignee_id,
          p_promised_at, p_source, coalesce(v_opened, now()), auth.uid())
  returning * into v_d;

  if p_message_id is not null then
    update public.messages set demand_id = v_d.id where id = p_message_id;
  end if;
  perform public.demand_event(v_d.id, 'created', null, p_source, p_message_id, p_actor);
  if p_promised_at is not null then
    perform public.demand_event(v_d.id, 'promised', null, p_promised_at::text, p_message_id, p_actor);
  end if;
  return v_d;
end;
$$;

-- Altera uma demanda. p_changes aceita: status, assignee_id, promised_at, description, type, confirmed
create or replace function public.update_demand(
  p_id uuid, p_changes jsonb, p_message_id uuid default null, p_actor text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.demands%rowtype;
  v_new public.demands%rowtype;
  v_key text;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('status', 'assignee_id', 'promised_at', 'description', 'type', 'confirmed') then
      raise exception 'Campo % não pode ser alterado', v_key;
    end if;
  end loop;

  select * into v_old from public.demands where id = p_id for update;
  if not found then raise exception 'Demanda não encontrada'; end if;
  v_new := v_old;

  if p_changes ? 'status' and (p_changes->>'status') is distinct from v_old.status then
    v_new.status := p_changes->>'status';
    if v_new.status = 'entregue' then
      v_new.delivered_at := now();
    elsif v_old.status = 'entregue' and v_new.status in ('aberta', 'em_andamento') then
      -- entregue e reaberta = retrabalho
      v_new.reopened_count := v_old.reopened_count + 1;
      v_new.delivered_at := null;
      v_new.confirmed_at := null;
      v_new.confirmation_message_id := null;
      perform public.demand_event(p_id, 'reopened', v_old.status, v_new.status, p_message_id, p_actor);
    end if;
    perform public.demand_event(p_id, 'status', v_old.status, v_new.status, p_message_id, p_actor);
  end if;

  if p_changes ? 'assignee_id' and (p_changes->>'assignee_id')::uuid is distinct from v_old.assignee_id then
    v_new.assignee_id := (p_changes->>'assignee_id')::uuid;
    perform public.demand_event(p_id, 'assigned',
      (select name from public.team_members where id = v_old.assignee_id),
      (select name from public.team_members where id = v_new.assignee_id), p_message_id, p_actor);
  end if;

  if p_changes ? 'promised_at' and (p_changes->>'promised_at')::timestamptz is distinct from v_old.promised_at then
    v_new.promised_at := (p_changes->>'promised_at')::timestamptz;
    perform public.demand_event(p_id, 'promised', v_old.promised_at::text, v_new.promised_at::text, p_message_id, p_actor);
  end if;

  if p_changes ? 'description' and coalesce(trim(p_changes->>'description'), '') <> ''
     and p_changes->>'description' is distinct from v_old.description then
    v_new.description := left(trim(p_changes->>'description'), 1000);
    perform public.demand_event(p_id, 'edited', 'descrição', null, p_message_id, p_actor);
  end if;

  if p_changes ? 'type' and nullif(trim(p_changes->>'type'), '') is distinct from v_old.type then
    v_new.type := nullif(trim(p_changes->>'type'), '');
    perform public.demand_event(p_id, 'edited', v_old.type, v_new.type, p_message_id, p_actor);
  end if;

  if p_changes ? 'confirmed' then
    if (p_changes->>'confirmed')::boolean and v_old.confirmed_at is null then
      v_new.confirmed_at := now();
      v_new.confirmation_message_id := p_message_id;
      perform public.demand_event(p_id, 'confirmed', null, null, p_message_id, p_actor);
    elsif not (p_changes->>'confirmed')::boolean and v_old.confirmed_at is not null then
      v_new.confirmed_at := null;
      v_new.confirmation_message_id := null;
      perform public.demand_event(p_id, 'unconfirmed', null, null, p_message_id, p_actor);
    end if;
  end if;

  update public.demands set
    status = v_new.status, assignee_id = v_new.assignee_id, promised_at = v_new.promised_at,
    description = v_new.description, type = v_new.type, delivered_at = v_new.delivered_at,
    confirmed_at = v_new.confirmed_at, confirmation_message_id = v_new.confirmation_message_id,
    reopened_count = v_new.reopened_count, updated_at = now()
  where id = p_id
  returning * into v_new;

  if p_message_id is not null then
    update public.messages set demand_id = p_id where id = p_message_id and demand_id is null;
  end if;
  return v_new;
end;
$$;

-- Cliente cobrou a demanda (registrado pelo worker ou manualmente)
create or replace function public.register_demand_followup(
  p_id uuid, p_message_id uuid default null, p_actor text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare v_d public.demands%rowtype;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.demands set followups_count = followups_count + 1, updated_at = now()
  where id = p_id returning * into v_d;
  if not found then raise exception 'Demanda não encontrada'; end if;
  perform public.demand_event(p_id, 'followup', null, v_d.followups_count::text, p_message_id, p_actor);
  if p_message_id is not null then
    update public.messages set demand_id = p_id where id = p_message_id and demand_id is null;
  end if;
  return v_d;
end;
$$;

revoke all on function public.demand_event(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_demand(uuid, text, uuid, text, uuid, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.update_demand(uuid, jsonb, uuid, text) to authenticated, service_role;
grant execute on function public.register_demand_followup(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Indicadores do Bloco 2
-- Filtro de período: demandas abertas no período; atendente = responsável
-- ---------------------------------------------------------------------
create or replace function public.ind_demand_scope(f jsonb)
returns table (
  id uuid, number bigint, group_id uuid, group_name text, description text, type text, assignee text,
  status text, opened_at timestamptz, promised_at timestamptz, delivered_at timestamptz,
  confirmed_at timestamptz, followups_count int, reopened_count int, source text
)
language sql stable set search_path = public
as $$
  select d.id, d.number, d.group_id, g.name, d.description, d.type, tm.name, d.status, d.opened_at,
         d.promised_at, d.delivered_at, d.confirmed_at, d.followups_count, d.reopened_count, d.source
  from public.demands d
  join public.groups g on g.id = d.group_id
  left join public.team_members tm on tm.id = d.assignee_id
  where d.opened_at >= (f->>'from')::timestamptz and d.opened_at < (f->>'to')::timestamptz
    and ((f->>'group_id') is null or d.group_id = (f->>'group_id')::uuid)
    and ((f->>'member_id') is null or d.assignee_id = (f->>'member_id')::uuid)
$$;

-- lista padrão de demandas (filtrada por um critério nomeado)
create or replace function public.ind_demands_list(f jsonb, p_filter text)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'number', 'label', '#', 'format', 'number', 'link_demand', true),
      jsonb_build_object('key', 'opened_at', 'label', 'Aberta em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'description', 'label', 'Demanda'),
      jsonb_build_object('key', 'assignee', 'label', 'Responsável'),
      jsonb_build_object('key', 'status_label', 'label', 'Status'),
      jsonb_build_object('key', 'promised_at', 'label', 'Prazo', 'format', 'datetime'),
      jsonb_build_object('key', 'delivered_at', 'label', 'Entregue em', 'format', 'datetime'),
      jsonb_build_object('key', 'resolution', 'label', 'Resolução', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'followups_count', 'label', 'Cobranças', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'confirmed', 'label', 'Confirmada', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'demand_id', id, 'number', number, 'opened_at', opened_at, 'group_id', group_id, 'group_name', group_name,
      'description', left(description, 200), 'assignee', coalesce(assignee, '—'),
      'status_label', case status when 'aberta' then 'Aberta' when 'em_andamento' then 'Em andamento'
                                   when 'entregue' then 'Entregue' else 'Cancelada' end,
      'promised_at', promised_at, 'delivered_at', delivered_at,
      'resolution', case when delivered_at is not null then extract(epoch from delivered_at - opened_at)::int end,
      'followups_count', followups_count,
      'confirmed', case when status <> 'entregue' then '—' when confirmed_at is not null then 'Sim' else 'Não' end
    ) order by opened_at desc), '[]'::jsonb)
  )
  from public.ind_demand_scope(f) d
  where case p_filter
    when 'all' then true
    when 'delivered' then status = 'entregue'
    when 'promised' then promised_at is not null and status <> 'cancelada'
    when 'rework' then reopened_count > 0 or followups_count >= coalesce((f->>'rework_threshold')::int, 2)
    else true end
$$;

create or replace function public.ind_demandas_abertas_concluidas(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f)),
  now_open as (
    select count(*) as n from public.demands x
    where x.status in ('aberta', 'em_andamento')
      and ((f->>'group_id') is null or x.group_id = (f->>'group_id')::uuid)
      and ((f->>'member_id') is null or x.assignee_id = (f->>'member_id')::uuid)
  )
  select jsonb_build_object(
    'visual', 'bars',
    'format', 'number',
    'hint', (select n from now_open) || ' demanda(s) em aberto agora · ' || (select count(*) from d) || ' aberta(s) no período',
    'series', jsonb_build_array(jsonb_build_object('key', 'total', 'label', 'Demandas')),
    'data', jsonb_build_array(
      jsonb_build_object('label', 'Aberta', 'total', (select count(*) from d where status = 'aberta')),
      jsonb_build_object('label', 'Em andamento', 'total', (select count(*) from d where status = 'em_andamento')),
      jsonb_build_object('label', 'Entregue', 'total', (select count(*) from d where status = 'entregue')),
      jsonb_build_object('label', 'Cancelada', 'total', (select count(*) from d where status = 'cancelada'))
    )
  )
$$;

create or replace function public.ind_demandas_abertas_concluidas_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'all') $$;

create or replace function public.ind_tempo_resolucao(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (
    select *, extract(epoch from delivered_at - opened_at)::int as t,
           public.business_seconds(opened_at, delivered_at, f) as tb
    from public.ind_demand_scope(f) where status = 'entregue' and delivered_at is not null
  ),
  agg as (
    select round(avg(t)) as avg_t, round(avg(tb)) as avg_tb,
           percentile_cont(0.5) within group (order by t) as med_t, count(*) as n
    from d
  ),
  trend as (
    select to_char((delivered_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, round(avg(t)) as value
    from d group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'duration',
    'value', agg.avg_t,
    'hint', agg.n || ' demanda(s) entregue(s) · do pedido até a entrega',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Tempo útil', 'value', agg.avg_tb, 'format', 'duration'),
      jsonb_build_object('label', 'Mediana', 'value', round(agg.med_t), 'format', 'duration')
    ),
    'trend', jsonb_build_object('format', 'duration',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from agg
$$;

create or replace function public.ind_tempo_resolucao_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'delivered') $$;

create or replace function public.ind_prazo_prometido_cumprido(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f) where promised_at is not null and status <> 'cancelada'),
  agg as (
    select count(*) filter (where status = 'entregue' and delivered_at <= promised_at) as on_time,
           count(*) filter (where status = 'entregue' and delivered_at > promised_at) as late,
           count(*) filter (where status <> 'entregue' and promised_at < now()) as overdue,
           count(*) filter (where status <> 'entregue' and promised_at >= now()) as running
    from d
  ),
  v as (select *, case when on_time + late + overdue > 0
                       then round(100.0 * on_time / (on_time + late + overdue), 1) end as pct from agg)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', pct,
    'tone', case when pct is null then null when overdue > 0 or pct < 70 then 'critical'
                 when pct < 90 then 'warning' else 'good' end,
    'hint', 'Prazos informados pela equipe e cumpridos',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'No prazo', 'value', on_time, 'format', 'number'),
      jsonb_build_object('label', 'Entregues atrasadas', 'value', late, 'format', 'number'),
      jsonb_build_object('label', 'Vencidas em aberto', 'value', overdue, 'format', 'number'),
      jsonb_build_object('label', 'Dentro do prazo', 'value', running, 'format', 'number')
    )
  )
  from v
$$;

create or replace function public.ind_prazo_prometido_cumprido_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'promised') $$;

create or replace function public.ind_retrabalho(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f)),
  agg as (
    select count(*) as n,
           count(*) filter (where reopened_count > 0) as reopened,
           count(*) filter (where followups_count >= coalesce((p->>'followups_threshold')::int, 2)) as chased,
           count(*) filter (where reopened_count > 0
                            or followups_count >= coalesce((p->>'followups_threshold')::int, 2)) as rework
    from d
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', rework,
    'tone', case when n = 0 then null when rework = 0 then 'good'
                 when 100.0 * rework / n < 15 then 'warning' else 'critical' end,
    'hint', case when n = 0 then 'Nenhuma demanda no período'
                 else round(100.0 * rework / n, 1) || '% das ' || n || ' demandas do período' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Reabertas', 'value', reopened, 'format', 'number'),
      jsonb_build_object('label', 'Cobradas ' || coalesce(p->>'followups_threshold', '2') || '+ vezes', 'value', chased, 'format', 'number')
    )
  )
  from agg
$$;

create or replace function public.ind_retrabalho_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f || jsonb_build_object('rework_threshold', coalesce((p->>'followups_threshold')::int, 2)), 'rework') $$;

create or replace function public.ind_confirmacao_cliente(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f) where status = 'entregue'),
  agg as (select count(*) as n, count(*) filter (where confirmed_at is not null) as ok from d)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', case when n > 0 then round(100.0 * ok / n, 1) end,
    'hint', ok || ' de ' || n || ' entrega(s) confirmada(s) pelo cliente',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Com confirmação', 'value', ok, 'format', 'number'),
      jsonb_build_object('label', 'Sem confirmação', 'value', n - ok, 'format', 'number')
    )
  )
  from agg
$$;

create or replace function public.ind_confirmacao_cliente_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'delivered') $$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('demandas_abertas_concluidas', 'entregas_demandas', 'Demandas por status',
   'Demandas abertas no período por status: aberta, em andamento, entregue e cancelada.', 1, 'bars', 2, false, false,
   '{}', '[]'),
  ('tempo_resolucao', 'entregas_demandas', 'Tempo de resolução',
   'Tempo entre o pedido do cliente e a entrega.', 2, 'kpi', 1, false, false,
   '{}', '[]'),
  ('prazo_prometido_cumprido', 'entregas_demandas', 'Prazos cumpridos',
   'Prazos informados pela equipe e se foram cumpridos.', 3, 'kpi', 1, true, true,
   '{}', '[]'),
  ('retrabalho', 'entregas_demandas', 'Retrabalho',
   'Demandas reabertas ou cobradas pelo cliente mais de uma vez.', 4, 'kpi', 1, true, false,
   '{"followups_threshold": 2, "followup_keywords": ["alguma novidade", "e aí", "cadê", "ainda não", "até quando", "previsão", "aguardando", "novidades", "conseguiram ver", "tem retorno"], "reopen_keywords": ["não funcionou", "nao funcionou", "continua", "de novo", "voltou a", "ainda está", "não resolveu", "deu erro"]}',
   '[{"key":"followups_threshold","label":"Cobranças para contar como retrabalho","type":"int","min":1,"max":20},{"key":"followup_keywords","label":"Palavras que indicam cobrança","type":"tags","help":"Mensagem do cliente com uma destas palavras, num grupo com demanda em aberto, conta como cobrança."},{"key":"reopen_keywords","label":"Palavras que reabrem uma entrega","type":"tags","help":"Mensagem do cliente com uma destas palavras logo após uma entrega reabre a demanda."}]'),
  ('confirmacao_cliente', 'entregas_demandas', 'Confirmação do cliente',
   'Entregas com e sem confirmação de recebimento do cliente.', 5, 'kpi', 1, false, false,
   '{"confirm_keywords": ["recebi", "recebido", "deu certo", "funcionou", "confirmado", "chegou", "perfeito, obrigado", "resolvido"], "confirm_window_days": 7}',
   '[{"key":"confirm_keywords","label":"Palavras de confirmação","type":"tags","help":"Mensagem do cliente com uma destas palavras confirma a última entrega do grupo."},{"key":"confirm_window_days","label":"Prazo para confirmar","type":"int","unit":"dias","min":1,"max":60}]')
on conflict (key) do nothing;

update public.indicators set params = default_params, enabled = default_enabled, alert_enabled = default_alert_enabled
where block_key = 'entregas_demandas' and updated_by is null and params = '{}'::jsonb and default_params <> '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Alertas ligados aos novos indicadores
-- ---------------------------------------------------------------------
alter table public.alert_rules drop constraint if exists alert_rules_type_check;
-- "not valid": ao executar este script de novo, não recusa regras de tipos criados por scripts
-- posteriores (ex.: 'recurrence', do 0015, que redefine esta lista logo depois)
alter table public.alert_rules add constraint alert_rules_type_check
  check (type in ('no_response', 'keyword', 'high_volume', 'disconnected', 'inactivity', 'deadline_missed', 'rework')) not valid;

insert into public.alert_rules (name, type, severity, cooldown_minutes, indicator_key)
select 'Prazo prometido vencido', 'deadline_missed', 'critical', 60, 'prazo_prometido_cumprido'
where not exists (select 1 from public.alert_rules where type = 'deadline_missed');
insert into public.alert_rules (name, type, severity, cooldown_minutes, indicator_key)
select 'Demanda com retrabalho', 'rework', 'warning', 60, 'retrabalho'
where not exists (select 1 from public.alert_rules where type = 'rework');

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- alerta ligado a uma demanda (prazo vencido, retrabalho)
alter table public.alerts add column if not exists demand_id uuid references public.demands(id) on delete cascade;
create index if not exists alerts_demand_idx on public.alerts (demand_id) where demand_id is not null;

-- >>>>>>>>>>>>>>>>>>>> 0011_relationship_context.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Indicadores (etapa 4): blocos 3 (Saúde do relacionamento) e
-- 4 (Contexto operacional).
--   - volume_por_grupo ganha a evolução diária de cada grupo
--   - grupos_silenciosos, cobrancas_reclamacoes, proporcao_cliente_equipe
--   - tipo_demanda, midias_arquivos
-- Regras de alerta de inatividade e de palavra-chave passam a seguir
-- os indicadores de grupos silenciosos e de cobranças/reclamações.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Busca de palavras-chave sem diferenciar acentos e maiúsculas
-- (mesma regra do worker: a palavra precisa aparecer inteira)
-- ---------------------------------------------------------------------
create or replace function public.norm_text(t text)
returns text
language sql immutable
as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

-- devolve a primeira palavra-chave encontrada no texto (ou null)
create or replace function public.match_keyword(p_text text, p_keywords jsonb)
returns text
language sql immutable set search_path = public
as $$
  select k.value
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_keywords) = 'array' then p_keywords else '[]'::jsonb end
       ) with ordinality as k(value, ord)
  where p_text is not null and btrim(k.value) <> ''
    and public.norm_text(p_text) ~ (
      '(^|[^[:alnum:]])'
      || regexp_replace(public.norm_text(btrim(k.value)), '([^[:alnum:] ])', '\\\1', 'g')
      || '($|[^[:alnum:]])')
  order by k.ord
  limit 1
$$;

-- primeira categoria cujas palavras aparecem no texto
create or replace function public.match_category(p_text text, p_categories jsonb)
returns text
language sql immutable set search_path = public
as $$
  select c.value->>'name'
  from jsonb_array_elements(
         case when jsonb_typeof(p_categories) = 'array' then p_categories else '[]'::jsonb end
       ) with ordinality as c(value, ord)
  where nullif(btrim(c.value->>'name'), '') is not null
    and public.match_keyword(p_text, c.value->'keywords') is not null
  order by c.ord
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Volume por grupo: comparação com o período anterior + evolução
-- ---------------------------------------------------------------------
create or replace function public.ind_volume_por_grupo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with bounds as (
    select (f->>'from')::timestamptz as d0, (f->>'to')::timestamptz as d1,
           (f->>'to')::timestamptz - (f->>'from')::timestamptz as len,
           ((f->>'from')::timestamptz at time zone (f->>'tz'))::date as day0,
           ((f->>'to')::timestamptz at time zone (f->>'tz'))::date as day1
  ),
  -- até 45 dias: um ponto por dia; acima disso, um ponto por semana
  buckets as (
    select b.day0 + (n * step) as bucket, n
    from bounds b,
         lateral (select case when b.day1 - b.day0 > 45 then 7 else 1 end as step) s,
         generate_series(0, (b.day1 - b.day0) / s.step) n
  ),
  scope as (select * from public.ind_scope(f)),
  prev as (
    select m.group_id, count(*) as total
    from public.messages m
    join public.groups g on g.id = m.group_id and g.monitored, bounds b
    where m.sent_at >= b.d0 - b.len and m.sent_at < b.d0
      and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    group by m.group_id
  ),
  cur as (
    select group_id, group_name,
           count(*) filter (where not from_team) as received,
           count(*) filter (where from_team) as sent,
           count(*) as total
    from scope group by group_id, group_name
  ),
  per_bucket as (
    select s.group_id,
           (select max(bk.n) from buckets bk where bk.bucket <= (s.sent_at at time zone (f->>'tz'))::date) as n,
           count(*) as c
    from scope s group by 1, 2
  ),
  spark as (
    select c.group_id,
           jsonb_agg(coalesce(pb.c, 0) order by bk.n) as points
    from cur c cross join buckets bk
    left join per_bucket pb on pb.group_id = c.group_id and pb.n = bk.n
    group by c.group_id
  ),
  vr as (
    select c.group_id, c.group_name, c.received, c.sent, c.total, sp.points as spark,
           coalesce(pv.total, 0) as previous,
           case when coalesce(pv.total, 0) = 0 then null
                else round(100.0 * (c.total - pv.total) / pv.total, 1) end as variation
    from cur c
    left join prev pv on pv.group_id = c.group_id
    left join spark sp on sp.group_id = c.group_id
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'spark', 'label', 'Evolução', 'format', 'spark'),
      jsonb_build_object('key', 'received', 'label', 'Clientes', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'sent', 'label', 'Equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'total', 'label', 'Total', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'previous', 'label', 'Período anterior', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'variation', 'label', 'Variação', 'format', 'percent_delta', 'align', 'right',
        'highlight_abs_gte', coalesce((p->>'variation_percent')::numeric, 50))
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(vr) order by total desc) from vr), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Grupos silenciosos (situação agora, independe do período)
-- ---------------------------------------------------------------------
create or replace function public.ind_silent_groups(f jsonb, p jsonb)
returns table (group_id uuid, group_name text, last_at timestamptz, days int, last_side text, last_body text)
language sql stable set search_path = public
as $$
  select g.id, g.name, coalesce(g.last_message_at, g.created_at),
         floor(extract(epoch from now() - coalesce(g.last_message_at, g.created_at)) / 86400)::int,
         case when lm.from_team then 'Equipe' when lm.id is not null then 'Cliente' end,
         left(coalesce(lm.body, '[' || lm.message_type || ']'), 200)
  from public.groups g
  left join lateral (
    select m.id, m.from_team, m.body, m.message_type from public.messages m
    where m.group_id = g.id order by m.sent_at desc limit 1
  ) lm on true
  where g.monitored and g.removed_at is null
    and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
    and coalesce(g.last_message_at, g.created_at)
        < now() - make_interval(days => greatest(coalesce((p->>'silent_days')::int, 3), 1))
$$;

create or replace function public.ind_grupos_silenciosos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with s as (select * from public.ind_silent_groups(f, p)),
  total as (
    select count(*) as n from public.groups g
    where g.monitored and g.removed_at is null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', (select count(*) from s),
    'tone', case when (select count(*) from s) = 0 then 'good' else 'warning' end,
    'hint', 'Sem mensagens há ' || coalesce((p->>'silent_days')::int, 3) || ' dia(s) ou mais · situação agora',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Grupos monitorados', 'value', (select n from total), 'format', 'number'),
      jsonb_build_object('label', 'Maior silêncio (dias)', 'value', (select max(days) from s), 'format', 'number'),
      jsonb_build_object('label', 'Última fala da equipe', 'value',
        (select count(*) from s where last_side = 'Equipe'), 'format', 'number')
    )
  )
$$;

create or replace function public.ind_grupos_silenciosos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'last_at', 'label', 'Última mensagem', 'format', 'datetime'),
      jsonb_build_object('key', 'days', 'label', 'Dias sem mensagem', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'last_side', 'label', 'Quem falou por último'),
      jsonb_build_object('key', 'last_body', 'label', 'Última mensagem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name, 'last_at', last_at, 'days', days,
      'last_side', coalesce(last_side, '—'), 'last_body', coalesce(last_body, '—')
    ) order by days desc), '[]'::jsonb)
  )
  from public.ind_silent_groups(f, p)
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Cobranças e reclamações
-- ---------------------------------------------------------------------
create or replace function public.ind_complaints(f jsonb, p jsonb)
returns table (id uuid, group_id uuid, group_name text, who text, body text, sent_at timestamptz, keyword text)
language sql stable set search_path = public
as $$
  select * from (
    select s.id, s.group_id, s.group_name, coalesce(s.sender_name, s.sender_phone, 'Cliente'), s.body, s.sent_at,
           public.match_keyword(s.body, p->'keywords') as keyword
    from public.ind_scope(f) s
    where not s.from_team and s.body is not null
  ) x where keyword is not null
$$;

create or replace function public.ind_cobrancas_reclamacoes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (select * from public.ind_complaints(f, p)),
  clients as (select count(*) as n from public.ind_scope(f) where not from_team),
  top_kw as (select keyword, count(*) as n from c group by 1 order by 2 desc limit 1),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as value
    from c group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', (select count(*) from c),
    'tone', case when (select count(*) from c) = 0 then 'good' else 'warning' end,
    'hint', coalesce('Mais frequente: "' || (select keyword from top_kw) || '"', 'Nenhuma mensagem de cobrança ou insatisfação'),
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Grupos', 'value', (select count(distinct group_id) from c), 'format', 'number'),
      jsonb_build_object('label', 'Das mensagens de clientes', 'value',
        case when (select n from clients) = 0 then null
             else round(100.0 * (select count(*) from c) / (select n from clients), 1) end, 'format', 'percent')
    ),
    'trend', jsonb_build_object('format', 'number',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
$$;

create or replace function public.ind_cobrancas_reclamacoes_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Data', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Cliente'),
      jsonb_build_object('key', 'keyword', 'label', 'Palavra'),
      jsonb_build_object('key', 'body', 'label', 'Mensagem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'keyword', keyword, 'body', left(body, 200)
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_complaints(f, p) order by sent_at desc limit 500) x
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Proporção cliente x equipe
-- ---------------------------------------------------------------------
create or replace function public.ind_proporcao_cliente_equipe(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with g as (
    select group_id, group_name,
           count(*) filter (where not from_team) as clients,
           count(*) filter (where from_team) as team
    from public.ind_scope(f) group by group_id, group_name
  ),
  r as (
    select *, case when clients = 0 then null else round(100.0 * team / clients) end as ratio from g
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'clients', 'label', 'Clientes', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'team', 'label', 'Equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'ratio', 'label', 'Equipe a cada 100', 'format', 'number', 'align', 'right',
        'warn_below', coalesce((p->>'min_team_percent')::numeric, 50))
    ),
    -- grupos com a equipe menos presente primeiro
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by ratio asc nulls last, clients desc) from r), '[]'::jsonb)
  )
$$;

create or replace function public.ind_proporcao_cliente_equipe_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Bloco 4 — Tipo de demanda
-- ---------------------------------------------------------------------
create or replace function public.ind_tipo_demanda(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with cats as (
    select c.value->>'name' as name, c.ord
    from jsonb_array_elements(coalesce(p->'categories', '[]'::jsonb)) with ordinality c(value, ord)
    where nullif(btrim(c.value->>'name'), '') is not null
  ),
  d as (select coalesce(nullif(btrim(type), ''), 'Sem tipo') as name, count(*) as n
        from public.ind_demand_scope(f) where status <> 'cancelada' group by 1),
  m as (
    select public.match_category(body, p->'categories') as name, count(*) as n
    from public.ind_scope(f)
    where not from_team and message_type = 'text' and body is not null
    group by 1
  ),
  labels as (
    select name, ord from cats
    union all
    select name, 1000 from d where name not in (select name from cats) and name <> 'Sem tipo'
    union all
    select 'Sem tipo', 2000 where exists (select 1 from d where name = 'Sem tipo')
  )
  -- tabela (e não gráfico): demandas e mensagens têm escalas muito diferentes
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'label', 'label', 'Categoria'),
      jsonb_build_object('key', 'demands', 'label', 'Demandas', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'messages', 'label', 'Mensagens', 'format', 'number', 'align', 'right', 'bar', true)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', l.name,
        'demands', coalesce((select n from d where d.name = l.name), 0),
        'messages', coalesce((select n from m where m.name = l.name), 0)
      ) order by l.ord, l.name)
      from labels l
    ), '[]'::jsonb)
  )
$$;

create or replace function public.ind_tipo_demanda_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'number', 'label', '#', 'format', 'number', 'link_demand', true),
      jsonb_build_object('key', 'opened_at', 'label', 'Aberta em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'type', 'label', 'Tipo'),
      jsonb_build_object('key', 'description', 'label', 'Demanda'),
      jsonb_build_object('key', 'source', 'label', 'Origem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'demand_id', id, 'number', number, 'opened_at', opened_at, 'group_id', group_id, 'group_name', group_name,
      'type', coalesce(nullif(btrim(type), ''), 'Sem tipo'), 'description', left(description, 200),
      'source', case source when 'manual' then 'Manual' when 'ai' then 'IA' else 'Comando/palavra-chave' end
    ) order by opened_at desc), '[]'::jsonb)
  )
  from public.ind_demand_scope(f)
  where status <> 'cancelada'
$$;

-- ---------------------------------------------------------------------
-- Bloco 4 — Mídias e arquivos (por grupo e remetente)
-- ---------------------------------------------------------------------
create or replace function public.ind_media(f jsonb, p jsonb)
returns setof public.messages
language sql stable set search_path = public
as $$
  select m.* from public.messages m
  where m.id in (select s.id from public.ind_scope(f) s)
    and m.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    and (m.message_type <> 'sticker' or coalesce((p->>'include_stickers')::boolean, false))
$$;

create or replace function public.ind_midias_arquivos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with x as (
    select m.group_id, g.name as group_name,
           coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, '—') as who,
           case when m.from_team then 'Equipe' else 'Cliente' end as side,
           m.message_type
    from public.ind_media(f, p) m
    join public.groups g on g.id = m.group_id
    left join public.team_members tm on tm.id = m.team_member_id
  ),
  r as (
    select group_id, group_name, who, side,
           count(*) filter (where message_type = 'image') as images,
           count(*) filter (where message_type = 'video') as videos,
           count(*) filter (where message_type = 'audio') as audios,
           count(*) filter (where message_type = 'document') as documents,
           count(*) filter (where message_type = 'sticker') as stickers,
           count(*) as total
    from x group by 1, 2, 3, 4
    order by total desc limit 100
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Remetente'),
      jsonb_build_object('key', 'side', 'label', 'Lado'),
      jsonb_build_object('key', 'images', 'label', 'Imagens', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'videos', 'label', 'Vídeos', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'audios', 'label', 'Áudios', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'documents', 'label', 'Documentos', 'format', 'number', 'align', 'right')
    ) || case when coalesce((p->>'include_stickers')::boolean, false)
              then jsonb_build_array(jsonb_build_object('key', 'stickers', 'label', 'Figurinhas', 'format', 'number', 'align', 'right'))
              else '[]'::jsonb end
      || jsonb_build_array(jsonb_build_object('key', 'total', 'label', 'Total', 'format', 'number', 'align', 'right', 'bar', true)),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by total desc) from r), '[]'::jsonb)
  )
$$;

create or replace function public.ind_midias_arquivos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Data', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Remetente'),
      jsonb_build_object('key', 'kind', 'label', 'Tipo'),
      jsonb_build_object('key', 'body', 'label', 'Arquivo / legenda')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', m.sent_at, 'group_id', m.group_id, 'group_name', g.name,
      'who', coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, '—'),
      'kind', case m.message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                  when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(m.body, 200), '—')
    ) order by m.sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_media(f, p) order by sent_at desc limit 500) m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
$$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('grupos_silenciosos', 'saude_relacionamento', 'Grupos silenciosos',
   'Grupos monitorados sem nenhuma mensagem há alguns dias.', 1, 'kpi', 1, true, true,
   '{"silent_days": 3}',
   '[{"key":"silent_days","label":"Dias sem mensagem","type":"int","unit":"dias","min":1,"max":365,"help":"As regras de alerta de inatividade com o mesmo prazo acompanham este valor."}]'),
  ('cobrancas_reclamacoes', 'saude_relacionamento', 'Cobranças e reclamações',
   'Mensagens de clientes com tom de cobrança ou insatisfação.', 2, 'kpi', 1, true, true,
   '{"keywords": ["urgente", "reclamação", "cancelar", "procon", "absurdo", "insatisfeito", "péssimo", "ninguém responde", "até quando", "cadê", "descaso", "demora"]}',
   '[{"key":"keywords","label":"Palavras-chave","type":"tags","help":"As regras de alerta de palavra-chave com a mesma lista acompanham as mudanças."}]'),
  ('proporcao_cliente_equipe', 'saude_relacionamento', 'Proporção cliente x equipe',
   'Mensagens da equipe para cada 100 mensagens de clientes, por grupo.', 3, 'table', 1, false, false,
   '{"min_team_percent": 50}',
   '[{"key":"min_team_percent","label":"Destacar grupos abaixo de","type":"int","unit":"msgs da equipe a cada 100","min":1,"max":1000}]'),
  ('tipo_demanda', 'contexto_operacional', 'Tipo de demanda',
   'Demandas abertas e mensagens de clientes por categoria (dúvida, erro, pedido novo, financeiro).', 2, 'table', 1, false, false,
   '{"categories": [{"name": "Financeiro", "keywords": ["boleto", "nota fiscal", "pagamento", "fatura", "cobrança", "pix", "reembolso"]}, {"name": "Erro", "keywords": ["erro", "não funciona", "bug", "travou", "problema", "parou", "falha"]}, {"name": "Dúvida", "keywords": ["dúvida", "como faço", "como funciona", "pergunta", "saber se"]}, {"name": "Pedido novo", "keywords": ["solicito", "preciso de", "gostaria", "orçamento", "pedido", "novo"]}]}',
   '[{"key":"categories","label":"Categorias","type":"categories","help":"A primeira categoria cujas palavras aparecem na mensagem vence. Também usadas como tipos das demandas."}]'),
  ('midias_arquivos', 'contexto_operacional', 'Mídias e arquivos',
   'Imagens, vídeos, áudios e documentos enviados, por grupo e remetente.', 3, 'table', 2, false, false,
   '{"include_stickers": false}',
   '[{"key":"include_stickers","label":"Contar figurinhas","type":"bool"}]')
on conflict (key) do update set visual = excluded.visual, description = excluded.description;

update public.indicators set params = default_params, enabled = default_enabled, alert_enabled = default_alert_enabled
where key in ('grupos_silenciosos', 'cobrancas_reclamacoes', 'proporcao_cliente_equipe', 'tipo_demanda', 'midias_arquivos')
  and updated_by is null and params = '{}'::jsonb;

-- volume por grupo vai para o fim do bloco, em largura total (tem a coluna de evolução)
update public.indicators set position = 4, size = 3 where key = 'volume_por_grupo' and updated_by is null;

-- ---------------------------------------------------------------------
-- Alertas: inatividade -> grupos silenciosos; palavra-chave -> cobranças
-- ---------------------------------------------------------------------
update public.alert_rules set indicator_key = 'grupos_silenciosos'
where type = 'inactivity' and indicator_key is null;
update public.alert_rules set indicator_key = 'cobrancas_reclamacoes'
where type = 'keyword' and indicator_key is null;

insert into public.alert_rules (name, type, severity, threshold_minutes, cooldown_minutes, indicator_key)
select 'Grupo silencioso', 'inactivity', 'warning', 3 * 1440, 1440, 'grupos_silenciosos'
where not exists (select 1 from public.alert_rules where type = 'inactivity');

-- a regra de palavras críticas original passa a usar a lista do indicador
update public.alert_rules r
set keywords = array(select jsonb_array_elements_text(i.params->'keywords')), updated_at = now()
from public.indicators i
where i.key = 'cobrancas_reclamacoes' and r.type = 'keyword'
  and r.keywords = array['urgente', 'reclamação', 'cancelar', 'procon', 'absurdo'];

-- mudar o parâmetro do indicador atualiza as regras que usavam o valor anterior
create or replace function public.sync_indicator_alert_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.key = 'grupos_silenciosos' and (new.params->>'silent_days') is not null
     and (new.params->'silent_days') is distinct from (old.params->'silent_days') then
    update public.alert_rules
    set threshold_minutes = (new.params->>'silent_days')::int * 1440, updated_at = now()
    where indicator_key = 'grupos_silenciosos' and type = 'inactivity'
      and threshold_minutes = coalesce((old.params->>'silent_days')::int, 3) * 1440;
  end if;
  if new.key = 'cobrancas_reclamacoes' and jsonb_typeof(new.params->'keywords') = 'array'
     and (new.params->'keywords') is distinct from (old.params->'keywords') then
    update public.alert_rules
    set keywords = array(select jsonb_array_elements_text(new.params->'keywords')), updated_at = now()
    where indicator_key = 'cobrancas_reclamacoes' and type = 'keyword'
      and keywords = array(select jsonb_array_elements_text(coalesce(old.params->'keywords', '[]'::jsonb)));
  end if;
  return new;
end;
$$;

drop trigger if exists indicators_sync_alert_rules on public.indicators;
create trigger indicators_sync_alert_rules after update on public.indicators
  for each row execute function public.sync_indicator_alert_rules();

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- >>>>>>>>>>>>>>>>>>>> 0012_replies.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Responder os grupos pelo painel.
--
-- O painel grava a mensagem numa fila (outgoing_messages) e o worker a
-- envia pela mesma conexão do WhatsApp lida no QR code. Como é um
-- aparelho conectado ao número, a mensagem aparece também no celular,
-- igual a uma mensagem enviada pelo WhatsApp Web.
-- A função é ligada/desligada em Configurações › Geral (só admin).
-- =====================================================================

alter table public.app_settings
  add column if not exists reply_enabled boolean not null default false,
  -- assina a mensagem com o nome de quem respondeu ("*Ana:*")
  add column if not exists reply_sign_name boolean not null default true,
  -- quem pode responder: todos os usuários ativos ou só administradores
  add column if not exists reply_allowed text not null default 'all';

do $$
begin
  alter table public.app_settings add constraint app_settings_reply_allowed_check check (reply_allowed in ('all', 'admin'));
exception when duplicate_object then null;
end $$;

create table if not exists public.outgoing_messages (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  instance_id        uuid not null references public.whatsapp_instances(id) on delete cascade,
  -- texto digitado (sem assinatura) e texto efetivamente enviado
  body               text not null,
  text_to_send       text not null,
  quoted_message_id  uuid references public.messages(id) on delete set null,
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  error              text,
  wa_message_id      text,
  sender_name        text not null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create index if not exists outgoing_messages_pending_idx on public.outgoing_messages (created_at) where status = 'pending';
create index if not exists outgoing_messages_group_idx on public.outgoing_messages (group_id, created_at desc);

alter table public.outgoing_messages enable row level security;
drop policy if exists outgoing_read on public.outgoing_messages;
create policy outgoing_read on public.outgoing_messages for select using (public.is_active_user());
-- escrita só pelas funções abaixo (e pelo worker, com a service_role)

-- ---------------------------------------------------------------------
-- Enviar
-- ---------------------------------------------------------------------
create or replace function public.can_reply()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active_user()
     and s.reply_enabled
     and (s.reply_allowed = 'all' or public.is_admin())
  from public.app_settings s where s.id = 1
$$;

create or replace function public.send_group_message(
  p_group_id uuid, p_body text, p_quoted_message_id uuid default null
)
returns public.outgoing_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.app_settings%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_row      public.outgoing_messages;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_settings from public.app_settings where id = 1;
  if not v_settings.reply_enabled then
    raise exception 'Responder pelo sistema está desligado. Um administrador pode ativar em Configurações › Geral.';
  end if;
  if v_settings.reply_allowed = 'admin' and not public.is_admin() then
    raise exception 'Só administradores podem responder pelo sistema.' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  if not v_group.monitored then
    raise exception 'Ative o monitoramento do grupo para responder por aqui.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.messages where id = p_quoted_message_id and group_id = p_group_id) then
    raise exception 'Mensagem citada não pertence a este grupo.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name
  from public.profiles where id = auth.uid();

  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by)
  values
    (p_group_id, v_group.instance_id, v_body,
     case when v_settings.reply_sign_name then '*' || v_name || ':*' || E'\n' || v_body else v_body end,
     p_quoted_message_id, v_name, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- tentar de novo uma mensagem que falhou
create or replace function public.retry_group_message(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_reply() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.outgoing_messages
  set status = 'pending', error = null, created_at = now()
  where id = p_id and status = 'failed';
end;
$$;

-- descartar uma mensagem que falhou (ou que ainda não saiu)
create or replace function public.discard_group_message(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.outgoing_messages
  where id = p_id and status in ('pending', 'failed')
    and (created_by = auth.uid() or public.is_admin());
end;
$$;

revoke all on function public.send_group_message(uuid, text, uuid) from public, anon;
revoke all on function public.retry_group_message(uuid) from public, anon;
revoke all on function public.discard_group_message(uuid) from public, anon;
revoke all on function public.can_reply() from public, anon;
grant execute on function public.send_group_message(uuid, text, uuid) to authenticated;
grant execute on function public.retry_group_message(uuid) to authenticated;
grant execute on function public.discard_group_message(uuid) to authenticated;
grant execute on function public.can_reply() to authenticated;

-- tempo real: a tela acompanha "enviando…" / "enviada" / "falhou"
do $$
begin
  begin alter publication supabase_realtime add table public.outgoing_messages; exception when others then null; end;
end $$;

-- atualiza o cache da API do Supabase (evita "Could not find the ... column in the schema cache")
notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0013_worker_lock.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Um único worker por vez usa o WhatsApp.
--
-- Duas cópias do worker com a mesma sessão (2 réplicas no Railway, a
-- sobreposição de um deploy ou um worker rodando no computador de
-- alguém com as mesmas variáveis) fazem o WhatsApp derrubar as duas
-- conexões ("428 Connection Terminated" / "Sessão aberta em outro local").
-- A trava abaixo garante que só quem a detém se conecta; a outra cópia
-- fica aguardando e aparece no painel.
-- =====================================================================

create table if not exists public.worker_lock (
  id           text primary key default 'whatsapp',
  holder       text not null,
  host         text,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null
);

alter table public.worker_lock enable row level security;
drop policy if exists worker_lock_read on public.worker_lock;
create policy worker_lock_read on public.worker_lock for select using (public.is_active_user());

-- pega ou renova a trava; devolve quem está com ela
create or replace function public.acquire_worker_lock(p_holder text, p_host text, p_ttl_seconds int default 45)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.worker_lock;
begin
  insert into public.worker_lock as l (id, holder, host, acquired_at, expires_at)
  values ('whatsapp', p_holder, p_host, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do update
    set holder = excluded.holder,
        host = excluded.host,
        acquired_at = case when l.holder = excluded.holder then l.acquired_at else now() end,
        expires_at = excluded.expires_at
    where l.holder = excluded.holder or l.expires_at < now();

  select * into r from public.worker_lock where id = 'whatsapp';
  return jsonb_build_object(
    'acquired', r.holder = p_holder,
    'holder', r.holder,
    'host', r.host,
    'expires_at', r.expires_at
  );
end;
$$;

create or replace function public.release_worker_lock(p_holder text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.worker_lock where id = 'whatsapp' and holder = p_holder;
$$;

revoke all on function public.acquire_worker_lock(text, text, int) from public, anon, authenticated;
revoke all on function public.release_worker_lock(text) from public, anon, authenticated;
grant execute on function public.acquire_worker_lock(text, text, int) to service_role;
grant execute on function public.release_worker_lock(text) to service_role;

-- atualiza o cache da API do Supabase (evita "Could not find the ... column in the schema cache")
notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0014_reincidence.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Indicador: Reincidência de falta de resposta (Bloco 1).
--
-- Falha de resposta = mensagem de cliente respondida fora do SLA ou ainda
-- sem resposta depois do SLA (mesmo critério do indicador "Respondidas
-- dentro do SLA": tempo útil ou corrido, conforme o parâmetro dele).
--
-- Grupo reincidente = teve pelo menos N falhas no período (parâmetro) ou,
-- opcionalmente, falhou de novo depois de já ter falhado no período anterior.
-- Índice = grupos reincidentes / grupos com alguma falha.
-- =====================================================================

-- todas as falhas de resposta do período (uma linha por mensagem/episódio)
create or replace function public.ind_response_failures(f jsonb)
returns table (
  group_id uuid, group_name text, client_name text, question text, asked_at timestamptz,
  delay_seconds int, sla_seconds int, kind text, responder text
)
language sql stable set search_path = public
as $$
  with o as (select public.sla_business_time_only() as useful)
  -- respondidas fora do SLA (o filtro de atendente vale para quem respondeu)
  select r.group_id, r.group_name, r.client_name, r.question, r.asked_at,
         case when o.useful then r.business_seconds else r.response_time_seconds end,
         r.sla_seconds, 'Respondida fora do SLA', r.responder
  from public.ind_responses(f) r, o
  where (case when o.useful then r.business_seconds else r.response_time_seconds end) > r.sla_seconds
  union all
  -- ainda sem resposta e já fora do SLA (a primeira mensagem que está esperando em cada grupo)
  select pm.group_id, pm.group_name, pm.client_name, left(coalesce(pm.body, '[' || pm.message_type || ']'), 200),
         pm.sent_at,
         case when o.useful then pm.waiting_business_seconds else pm.waiting_seconds end,
         pm.sla_seconds, 'Sem resposta até agora', null
  from (
    select distinct on (x.group_id) x.*
    from public.ind_pending_messages(f, '{}'::jsonb) x
    order by x.group_id, x.sent_at
  ) pm, o
  where pm.overdue
    and (f->>'member_id') is null
    and pm.sent_at >= (f->>'from')::timestamptz and pm.sent_at < (f->>'to')::timestamptz
$$;

-- falhas por grupo no período, comparadas com o período anterior de mesmo tamanho
create or replace function public.ind_recurrence_by_group(f jsonb, p jsonb)
returns table (
  group_id uuid, group_name text, failures int, days int, worst_seconds int, last_failure timestamptz,
  previous int, recurrent boolean
)
language sql stable set search_path = public
as $$
  with prevf as (
    select f || jsonb_build_object(
      'from', (f->>'from')::timestamptz - ((f->>'to')::timestamptz - (f->>'from')::timestamptz),
      'to', (f->>'from')::timestamptz
    ) as pf
  ),
  cur as (
    select x.group_id, x.group_name, count(*)::int as failures,
           count(distinct (x.asked_at at time zone (f->>'tz'))::date)::int as days,
           max(x.delay_seconds) as worst, max(x.asked_at) as last_at
    from public.ind_response_failures(f) x
    group by 1, 2
  ),
  prev as (
    select x.group_id, count(*)::int as n
    from prevf, public.ind_response_failures(prevf.pf) x
    group by 1
  )
  select c.group_id, c.group_name, c.failures, c.days, c.worst, c.last_at, coalesce(pv.n, 0),
         c.failures >= greatest(coalesce((p->>'min_failures')::int, 2), 1)
         or (coalesce((p->>'count_previous_period')::boolean, true) and coalesce(pv.n, 0) > 0)
  from cur c left join prev pv on pv.group_id = c.group_id
$$;

create or replace function public.ind_reincidencia_sem_resposta(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with g as (select * from public.ind_recurrence_by_group(f, p)),
  agg as (
    select count(*) as groups, count(*) filter (where recurrent) as recurrent,
           coalesce(sum(failures), 0) as failures,
           count(*) filter (where previous > 0) as repeat_prev
    from g
  ),
  top as (select group_name, failures from g where recurrent order by failures desc, last_failure desc limit 1),
  trend as (
    select to_char((asked_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as value
    from public.ind_response_failures(f) group by 1 order by 1
  ),
  v as (
    select case when groups = 0 then 0 else round(100.0 * recurrent / groups, 1) end as pct, * from agg
  )
  select jsonb_build_object(
    'visual', 'kpi',
    -- destaque: quantos grupos reincidiram; o percentual fica nos detalhes
    'format', 'number',
    'value', v.recurrent,
    'unit', case when v.recurrent = 1 then 'grupo reincidente' else 'grupos reincidentes' end,
    'tone', case when v.recurrent = 0 then 'good'
                 when v.pct <= coalesce((p->>'target_percent')::numeric, 20) then 'warning'
                 else 'critical' end,
    'hint', case when v.groups = 0 then 'Nenhuma falha de resposta no período'
                 when v.recurrent = 0 then 'Nenhum grupo reincidente · ' || v.groups || ' grupo(s) com falha isolada'
                 else 'de ' || v.groups || ' grupo(s) com falha de resposta'
                      || coalesce(' · mais reincidente: ' || (select group_name || ' (' || failures || ' falhas)' from top), '')
            end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Índice de reincidência', 'value', v.pct, 'format', 'percent'),
      jsonb_build_object('label', 'Falhas de resposta', 'value', v.failures, 'format', 'number'),
      jsonb_build_object('label', 'Falharam também no período anterior', 'value', v.repeat_prev, 'format', 'number')
    ),
    'trend', jsonb_build_object('format', 'number', 'label', 'Falhas de resposta no dia',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from v
$$;

-- detalhe: ranking dos grupos (reincidentes primeiro)
create or replace function public.ind_reincidencia_sem_resposta_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'recurrent_label', 'label', 'Reincidente'),
      jsonb_build_object('key', 'failures', 'label', 'Falhas', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'days', 'label', 'Dias com falha', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'previous', 'label', 'Período anterior', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'worst_seconds', 'label', 'Pior atraso', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'last_failure', 'label', 'Última falha', 'format', 'datetime')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name,
      'recurrent_label', case when recurrent then 'Sim' else 'Não' end,
      'failures', failures, 'days', days, 'previous', previous,
      'worst_seconds', worst_seconds, 'last_failure', last_failure
    ) order by recurrent desc, failures desc, last_failure desc), '[]'::jsonb)
  )
  from public.ind_recurrence_by_group(f, p)
$$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('reincidencia_sem_resposta', 'capacidade_resposta', 'Reincidência de falta de resposta',
   'Percentual dos grupos com falha de resposta (fora do SLA ou ainda sem resposta) que voltaram a falhar.',
   5, 'kpi', 1, false, false,
   '{"min_failures": 2, "count_previous_period": true, "target_percent": 20}',
   '[{"key":"min_failures","label":"Falhas no período para ser reincidente","type":"int","min":2,"max":50,"help":"Uma falha é uma mensagem respondida fora do SLA ou ainda sem resposta depois dele."},{"key":"count_previous_period","label":"Contar quem já falhou no período anterior","type":"bool","help":"Ligado: um grupo que falhou de novo após ter falhado no período anterior também é reincidente."},{"key":"target_percent","label":"Aceitável até","type":"int","unit":"%","min":0,"max":100,"help":"Acima disso o indicador fica vermelho."}]')
on conflict (key) do nothing;

-- descrição: o destaque é a quantidade de grupos reincidentes
update public.indicators
set description = 'Grupos que voltaram a ter falha de resposta (fora do SLA ou ainda sem resposta) e o percentual que representam entre os grupos com falha.'
where key = 'reincidencia_sem_resposta';

update public.indicators set params = default_params, enabled = default_enabled, alert_enabled = default_alert_enabled
where key = 'reincidencia_sem_resposta' and updated_by is null and params = '{}'::jsonb;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0015_recurrence_alert.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Alerta de reincidência de falta de resposta.
--
-- Regra do tipo "recurrence": avisa quando um grupo acumula
-- threshold_count falhas de resposta (fora do SLA ou ainda sem resposta)
-- nos últimos threshold_minutes (a tela mostra em dias).
-- Segue o indicador "reincidencia_sem_resposta": com o indicador ou o
-- alerta dele desligado, a regra não dispara.
-- =====================================================================

alter table public.alert_rules drop constraint if exists alert_rules_type_check;
alter table public.alert_rules add constraint alert_rules_type_check
  check (type in ('no_response', 'keyword', 'high_volume', 'disconnected', 'inactivity', 'deadline_missed', 'rework', 'recurrence'));

-- o indicador passa a ter alerta (ligado por padrão)
update public.indicators
set supports_alert = true, default_alert_enabled = true
where key = 'reincidencia_sem_resposta';
update public.indicators
set alert_enabled = true
where key = 'reincidencia_sem_resposta' and updated_by is null;

-- regra padrão: 3 falhas em 7 dias, no máximo um aviso por dia por grupo
insert into public.alert_rules (name, type, severity, threshold_count, threshold_minutes, cooldown_minutes, indicator_key)
select 'Grupo reincidente sem resposta', 'recurrence', 'warning', 3, 7 * 1440, 1440, 'reincidencia_sem_resposta'
where not exists (select 1 from public.alert_rules where type = 'recurrence');

-- grupos que atingiram o limite na janela (usado pelo worker)
create or replace function public.recurrence_alert_candidates(p_window_minutes int, p_min_failures int)
returns table (group_id uuid, group_name text, failures int, last_failure timestamptz, worst_seconds int)
language sql stable security definer set search_path = public
as $$
  select x.group_id, x.group_name, count(*)::int, max(x.asked_at), max(x.delay_seconds)
  from public.ind_response_failures(
    public.indicator_filters(now() - make_interval(mins => greatest(p_window_minutes, 60)), now(), null, null)
  ) x
  group by x.group_id, x.group_name
  having count(*) >= greatest(p_min_failures, 1)
$$;

revoke all on function public.recurrence_alert_candidates(int, int) from public, anon, authenticated;
grant execute on function public.recurrence_alert_candidates(int, int) to service_role;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0016_peak_hours.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Horários de pico mais fácil de ler.
--
-- Além do mapa dia × hora, o indicador passa a devolver:
--   highlights: frases-resumo (pico, dia mais movimentado, fora do expediente)
--   by_hour:    total de mensagens de clientes por hora do dia (0h a 23h)
--   by_day:     total por dia da semana (segunda a domingo)
--   business:   horário comercial, para destacar o expediente no gráfico
-- O painel desenha o resumo e os dois gráficos; o mapa fica como detalhe.
-- =====================================================================

create or replace function public.ind_horarios_pico(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with m as (
    select extract(isodow from sent_at at time zone (f->>'tz'))::int as dw,   -- 1 = segunda ... 7 = domingo
           extract(hour from sent_at at time zone (f->>'tz'))::int as hr,
           public.is_business_time(sent_at, f) as in_business
    from public.ind_scope(f) where not from_team
  ),
  days as (
    select d, (array['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])[d] as short,
           (array['segunda','terça','quarta','quinta','sexta','sábado','domingo'])[d] as long
    from generate_series(1, 7) d
  ),
  grid as (
    select days.d, hs.h, (select count(*) from m where m.dw = days.d and m.hr = hs.h)::int as n
    from days, generate_series(0, 23) as hs(h)
  ),
  by_hour as (select h, sum(n)::int as n from grid group by h),
  by_day as (select d, sum(n)::int as n from grid group by d),
  tot as (select count(*)::int as n, count(*) filter (where not in_business)::int as outside from m),
  -- pico = hora do dia com mais mensagens somando todos os dias (o mesmo destacado no gráfico)
  peak as (select h, n from by_hour order by n desc, h limit 1),
  peak_hour_day as (
    select g.d from grid g, peak where g.h = peak.h order by g.n desc, g.d limit 1
  ),
  peak_day as (select d, n from by_day order by n desc, d limit 1),
  -- faixa de 2 horas seguidas mais movimentada (no dia típico)
  peak_window as (
    select h, n + coalesce((select b2.n from by_hour b2 where b2.h = b1.h + 1), 0) as n2
    from by_hour b1 where h < 23 order by 2 desc, h limit 1
  ),
  bh as (
    select extract(hour from (f->>'business_start')::time)::int as start_h,
           ceil(extract(epoch from (f->>'business_end')::time) / 3600)::int as end_h
  )
  select jsonb_build_object(
    'visual', 'heatmap',
    'rows', (select jsonb_agg(short order by d) from days),
    'cols', (select jsonb_agg(lpad(h::text, 2, '0') || 'h' order by h) from generate_series(0, 23) h),
    'values', (select jsonb_agg(r order by d) from (select d, jsonb_agg(n order by h) as r from grid group by d) x),
    'total', (select n from tot),
    'by_hour', (select jsonb_agg(jsonb_build_object('label', lpad(h::text, 2, '0') || 'h', 'value', n) order by h) from by_hour),
    'by_day', (select jsonb_agg(jsonb_build_object('label', days.short, 'value', by_day.n) order by days.d)
               from by_day join days using (d)),
    'business', (select jsonb_build_object('start_hour', start_h, 'end_hour', end_h,
                   'days', coalesce(f->'business_days', '[]'::jsonb)) from bh),
    'highlights', case when (select n from tot) = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'label', 'Horário de pico',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 1)::text, 2, '0') || 'h' from peak),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens · mais forte ' ||
                          (select case when days.d in (6, 7) then 'no ' else 'na ' end || days.long from peak_hour_day join days using (d))
                   from peak)),
      jsonb_build_object(
        'label', 'Faixa mais movimentada',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 2)::text, 2, '0') || 'h' from peak_window),
        'detail', (select round(100.0 * n2 / nullif((select n from tot), 0)) || '% das mensagens do período' from peak_window)),
      jsonb_build_object(
        'label', 'Dia mais movimentado',
        'value', (select initcap(days.long) from peak_day join days using (d)),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens' from peak_day)),
      jsonb_build_object(
        'label', 'Fora do expediente',
        'value', (select round(100.0 * outside / nullif(n, 0)) || '%' from tot),
        'detail', (select outside || ' de ' || n || ' mensagens' from tot),
        'tone', (select case when 100.0 * outside / nullif(n, 0) >= 30 then 'warning' end from tot))
    ) end,
    'hint', case when (select n from tot) = 0 then 'Sem mensagens de clientes no período'
                 else (select n || ' mensagens de clientes no período' from tot) end
  )
$$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

update public.indicators
set description = 'Quando os clientes mais escrevem: horário e dia de pico, movimento por hora e por dia da semana e quanto chega fora do expediente.'
where key = 'horarios_pico';

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0017_dashboard_cards.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Ajustes de cartões do dashboard:
--  * Mensagens pendentes: lista os grupos, um por linha, com quantas
--    mensagens estão pendentes e há quanto tempo o cliente espera.
--  * Novo cartão "Imagens e arquivos recebidos" (os mais recentes que os
--    clientes enviaram), que substitui "Mídias e arquivos" (desligado,
--    continua no catálogo e pode ser religado).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mensagens pendentes com lista por grupo
-- ---------------------------------------------------------------------
create or replace function public.ind_mensagens_pendentes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with pm as (select * from public.ind_pending_messages(f, p)),
  agg as (
    select count(*) as n, count(distinct group_id) as groups, count(*) filter (where overdue) as late,
           max(waiting_seconds) as longest
    from pm
  ),
  by_group as (
    select group_id, group_name, count(*)::int as n, max(waiting_seconds) as longest, bool_or(overdue) as late
    from pm group by group_id, group_name
  ),
  -- lista completa (até 50 grupos); o cartão mostra list_size e a TV/tela cheia mostram todos
  top as (
    select * from by_group
    order by late desc, longest desc, n desc
    limit 50
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'mensagem pendente' else 'mensagens pendentes' end,
    'tone', case when late > 0 then 'critical' when n > 0 then 'warning' else 'good' end,
    'hint', case when n = 0 then 'Todos os clientes foram respondidos'
                 else 'em ' || groups || ' grupo(s) · ' || late || ' fora do SLA · tempo = espera mais longa' end,
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id, 'value', n,
        'unit', jsonb_build_array('pendente', 'pendentes'),
        'detail', longest, 'detail_format', 'duration',
        'tone', case when late then 'critical' else 'warning' end
      ) order by late desc, longest desc, n desc)
      from top
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 5), 1),
    'list_more', greatest(groups - (select count(*) from top), 0)
  )
  from agg
$$;

-- tamanho da lista é um parâmetro do indicador
update public.indicators
set default_params = default_params || '{"list_size": 5}',
    params = case when params ? 'list_size' then params else params || '{"list_size": 5}' end,
    param_schema = case when param_schema @> '[{"key":"list_size"}]' then param_schema
                        else param_schema || '[{"key":"list_size","label":"Grupos listados no cartão","type":"int","min":1,"max":15}]'::jsonb end
where key = 'mensagens_pendentes';

-- ---------------------------------------------------------------------
-- Imagens e arquivos recebidos
-- ---------------------------------------------------------------------
-- (o script 0020 muda as colunas devolvidas: apaga antes para poder executar este script de novo)
drop function if exists public.ind_received_files(jsonb, jsonb);
create function public.ind_received_files(f jsonb, p jsonb)
returns table (
  id uuid, group_id uuid, group_name text, who text, message_type text, body text, sent_at timestamptz, from_team boolean
)
language sql stable set search_path = public
as $$
  select m.id, m.group_id, g.name,
         coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, 'Cliente'),
         m.message_type, m.body, m.sent_at, m.from_team
  from public.ind_media(f, p) m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
  where coalesce((p->>'include_team')::boolean, false) or not m.from_team
$$;

create or replace function public.ind_arquivos_recebidos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_received_files(f, p)),
  agg as (
    select count(*)::int as n,
           count(*) filter (where message_type = 'image')::int as images,
           count(*) filter (where message_type = 'document')::int as documents,
           count(*) filter (where message_type = 'video')::int as videos,
           count(*) filter (where message_type = 'audio')::int as audios,
           count(distinct group_id)::int as groups
    from r
  ),
  -- os 30 mais recentes; o cartão mostra list_size e a TV/tela cheia mostram todos
  latest as (
    select * from r order by sent_at desc limit 30
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'arquivo recebido' else 'arquivos recebidos' end,
    'hint', case when n = 0 then 'Nenhuma imagem ou arquivo recebido no período'
                 else 'de clientes em ' || groups || ' grupo(s) · mais recentes abaixo' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Imagens', 'value', images, 'format', 'number'),
      jsonb_build_object('label', 'Documentos', 'value', documents, 'format', 'number'),
      jsonb_build_object('label', 'Vídeos', 'value', videos, 'format', 'number'),
      jsonb_build_object('label', 'Áudios', 'value', audios, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'icon', message_type,
        'label', coalesce(nullif(btrim(body), ''),
                          case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo'
                                            when 'audio' then 'Áudio' when 'document' then 'Documento' else 'Figurinha' end),
        'sublabel', group_name || ' · ' || who,
        'group_id', group_id,
        'detail', sent_at, 'detail_format', 'datetime'
      ) order by sent_at desc)
      from latest
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 6), 1),
    'list_more', greatest(n - (select count(*) from latest), 0)
  )
  from agg
$$;

create or replace function public.ind_arquivos_recebidos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Recebido em', 'format', 'datetime'),
      jsonb_build_object('key', 'kind', 'label', 'Tipo'),
      jsonb_build_object('key', 'body', 'label', 'Arquivo / legenda'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Enviado por')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'kind', case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(body, 200), '—')
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_received_files(f, p) order by sent_at desc limit 500) x
$$;

do $$
begin
  if not exists (select 1 from public.indicators where key = 'arquivos_recebidos') then
    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('arquivos_recebidos', 'contexto_operacional', 'Imagens e arquivos recebidos',
       'Imagens, documentos, vídeos e áudios enviados pelos clientes, com os mais recentes.', 3, 'kpi', 2, false, false,
       '{"list_size": 6, "include_team": false, "include_stickers": false}',
       '[{"key":"list_size","label":"Arquivos listados no cartão","type":"int","min":1,"max":15},{"key":"include_team","label":"Contar também os enviados pela equipe","type":"bool"},{"key":"include_stickers","label":"Contar figurinhas","type":"bool"}]');
    update public.indicators set params = default_params where key = 'arquivos_recebidos';
    -- substitui o cartão antigo (continua no catálogo; o admin pode religar)
    update public.indicators set enabled = false, position = 9 where key = 'midias_arquivos';
  end if;
end $$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0018_response_from_last_message.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Tempo de resposta contado a partir da ÚLTIMA mensagem do cliente.
--
-- Antes: quando o cliente mandava várias mensagens seguidas, o tempo era
-- medido desde a primeira delas. Agora vale a última mensagem do cliente
-- antes da resposta da equipe (é a que foi de fato respondida).
-- A pendência (fila de "sem resposta" e alertas) continua contando desde a
-- primeira mensagem, porque o cliente está esperando desde ela.
-- Os tempos já gravados são recalculados no fim deste script.
-- =====================================================================

-- Mesma função de antes (0007), mudando só o início da contagem
create or replace function public.ingest_message(
  p_group_id       uuid,
  p_wa_message_id  text,
  p_sender_jid     text,
  p_sender_phone   text,
  p_sender_name    text,
  p_from_me        boolean,
  p_from_team      boolean,
  p_team_member_id uuid,
  p_message_type   text,
  p_body           text,
  p_sent_at        timestamptz,
  p_opens_pending  boolean default true -- false para "ok", "obrigado" etc.
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_group     public.groups%rowtype;
  v_msg_id    uuid;
  v_response  int;
  v_answered  uuid;
  v_is_latest boolean;
  v_preview   text;
  v_last_client timestamptz;
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at, opens_pending
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at,
    coalesce(p_opens_pending, true)
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
  end if;

  -- mensagens antigas (sincronização de histórico) não alteram o estado atual
  v_is_latest := v_group.last_message_at is null or p_sent_at >= v_group.last_message_at;
  v_preview := left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160);

  if not v_is_latest then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'stale', true);
  end if;

  if p_from_team then
    if v_group.pending_since is not null then
      -- tempo desde a última mensagem do cliente antes desta resposta
      select id, sent_at into v_answered, v_last_client
      from public.messages
      where group_id = p_group_id and not from_team and sent_at <= p_sent_at and sent_at >= v_group.pending_since
      order by sent_at desc, created_at desc limit 1;
      v_response := greatest(0, extract(epoch from (p_sent_at - coalesce(v_last_client, v_group.pending_since)))::int);
      v_answered := coalesce(v_answered, v_group.pending_message_id);
      update public.messages
         set response_time_seconds = v_response, answered_message_id = v_answered
       where id = v_msg_id;
    end if;

    update public.groups set
      pending_since = null,
      pending_message_id = null,
      pending_count = 0,
      last_message_at = p_sent_at,
      last_team_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;

    -- resolve automaticamente alertas de "sem resposta" do grupo
    if v_response is not null then
      update public.alerts set status = 'resolved', resolved_at = now()
       where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
    end if;
  elsif not p_opens_pending and v_group.pending_since is null then
    -- agradecimento/confirmação após a resposta: não exige nova resposta
    update public.groups set
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  else
    update public.groups set
      pending_since = coalesce(pending_since, p_sent_at),
      pending_message_id = coalesce(pending_message_id, v_msg_id),
      pending_count = pending_count + 1,
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'message_id', v_msg_id,
    'response_time_seconds', v_response,
    'answered_message_id', v_answered
  );
end;
$$;

comment on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean)
  is 'Tempo de resposta desde a última mensagem do cliente (0018)';

-- Recálculo do histórico com a mesma regra
-- Recalcula, em ordem cronológica, os tempos de resposta e a situação atual
-- do grupo (usado após importar o histórico).
create or replace function public.rebuild_group_state(p_group_id uuid, p_live_since timestamptz default now())
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_msg             record;
  v_pending_since   timestamptz;
  v_pending_msg     uuid;
  v_pending_count   int := 0;
  v_last            record;
  v_last_client     timestamptz;
  v_last_team       timestamptz;
  v_resp            int;
  v_answered        uuid;
  v_last_pending_at  timestamptz;
  v_last_pending_msg uuid;
begin
  perform 1 from public.groups where id = p_group_id for update;

  for v_msg in
    select id, from_team, opens_pending, sent_at, response_time_seconds, answered_message_id
    from public.messages where group_id = p_group_id order by sent_at, created_at
  loop
    if v_msg.from_team then
      v_last_team := v_msg.sent_at;
      if v_pending_since is not null then
        v_resp := greatest(0, extract(epoch from (v_msg.sent_at - v_last_pending_at))::int);
        v_answered := v_last_pending_msg;
      else
        v_resp := null;
        v_answered := null;
      end if;
      if v_msg.response_time_seconds is distinct from v_resp or v_msg.answered_message_id is distinct from v_answered then
        update public.messages set response_time_seconds = v_resp, answered_message_id = v_answered where id = v_msg.id;
      end if;
      v_pending_since := null;
      v_pending_msg := null;
      v_pending_count := 0;
    else
      v_last_client := v_msg.sent_at;
      if v_msg.opens_pending or v_pending_since is not null then
        v_last_pending_at := v_msg.sent_at;
        v_last_pending_msg := v_msg.id;
        v_pending_since := coalesce(v_pending_since, v_msg.sent_at);
        v_pending_msg := coalesce(v_pending_msg, v_msg.id);
        v_pending_count := v_pending_count + 1;
      end if;
    end if;
  end loop;

  -- pendências antigas vindas do histórico (anteriores à conexão) provavelmente
  -- foram resolvidas por outro canal: só ficam na fila as das últimas 24 horas
  if v_pending_since is not null
     and v_pending_since < p_live_since
     and v_pending_since < now() - interval '24 hours' then
    -- recomeça a contagem pelas mensagens de cliente das últimas 24 horas (se houver)
    select min(sent_at), (array_agg(id order by sent_at))[1], count(*)
      into v_pending_since, v_pending_msg, v_pending_count
    from public.messages
    where group_id = p_group_id and not from_team and opens_pending
      and sent_at >= now() - interval '24 hours'
      and sent_at > coalesce(v_last_team, '-infinity'::timestamptz);
    if v_pending_count = 0 then
      v_pending_since := null;
      v_pending_msg := null;
    end if;
  end if;

  select sent_at, sender_name, body, message_type into v_last
  from public.messages where group_id = p_group_id order by sent_at desc, created_at desc limit 1;

  update public.groups set
    pending_since = v_pending_since,
    pending_message_id = v_pending_msg,
    pending_count = v_pending_count,
    last_message_at = v_last.sent_at,
    last_client_message_at = v_last_client,
    last_team_message_at = v_last_team,
    last_message_preview = case when v_last.sent_at is null then null
      else left(coalesce(v_last.sender_name || ': ', '') || coalesce(v_last.body, '[' || v_last.message_type || ']'), 160) end
  where id = p_group_id;
end;
$$;

revoke all on function public.rebuild_group_state(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rebuild_group_state(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- Recalcula os tempos já gravados: última mensagem do cliente antes de
-- cada resposta (entre a resposta anterior da equipe e esta). Respostas sem
-- mensagem do cliente nesse intervalo ficam como estavam.
-- ---------------------------------------------------------------------
update public.messages r
set response_time_seconds = x.secs, answered_message_id = x.cid
from (
  select t.id, c.id as cid, greatest(0, extract(epoch from (t.sent_at - c.sent_at))::int) as secs
  from public.messages t
  cross join lateral (
    select q.id, q.sent_at from public.messages q
    where q.group_id = t.group_id and not q.from_team and q.sent_at <= t.sent_at
      -- só as mensagens depois da resposta anterior da equipe
      and q.sent_at > coalesce((select max(e.sent_at) from public.messages e
                                where e.group_id = t.group_id and e.from_team and e.sent_at < t.sent_at), '-infinity')
    order by q.sent_at desc, q.created_at desc limit 1
  ) c
  where t.from_team and t.response_time_seconds is not null
) x
where r.id = x.id
  and (r.answered_message_id is distinct from x.cid or r.response_time_seconds is distinct from x.secs);

-- ---------------------------------------------------------------------
-- Detalhamento das respostas agrupado por grupo: cada grupo vira um
-- cabeçalho com a quantidade de respostas, os tempos médios e o SLA.
-- ---------------------------------------------------------------------
create or replace function public.ind_responses_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with o as (select public.sla_business_time_only() as useful)
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'asked_at', 'label', 'Última msg. do cliente', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'question', 'label', 'Mensagem do cliente'),
      jsonb_build_object('key', 'responder', 'label', 'Respondido por'),
      jsonb_build_object('key', 'shift', 'label', 'Chegou', 'format', 'text'),
      jsonb_build_object('key', 'response_time_seconds', 'label', 'Tempo corrido', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'business_seconds', 'label', 'Tempo útil', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'in_sla', 'label', 'No SLA', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'asked_at', asked_at, 'group_id', group_id, 'group_name', group_name, 'client_name', client_name,
      'question', left(coalesce(question, '[mídia]'), 200), 'responder', responder,
      'shift', case when asked_in_business then 'No expediente' else 'Fora do expediente' end,
      'response_time_seconds', response_time_seconds, 'business_seconds', business_seconds,
      'in_sla', case when (case when o.useful then business_seconds else response_time_seconds end) <= sla_seconds
                     then 'Sim' else 'Não' end
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_responses(f) order by sent_at desc limit 500) x, o
$$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0019_reply_analysis.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Análise "Precisa de resposta?"
--
-- Para cada grupo, olha as últimas mensagens dos clientes depois da última
-- mensagem da equipe e decide, por regras, se a conversa precisa de
-- resposta:
--  * Precisa:     pergunta, pedido, problema/urgência ou o cliente
--                 respondeu a uma pergunta da equipe.
--  * Verificar:   áudio, arquivo sem texto, só cumprimento, ou o cliente
--                 encerrou ("ok", "obrigado") depois de ter pedido algo.
--  * Não precisa: agradecimento/encerramento, risadas e emojis, ou
--                 mensagens sem pergunta, pedido ou problema.
-- As listas de palavras ficam nos parâmetros do indicador e podem ser
-- editadas em Configurações › Indicadores.
-- =====================================================================

-- Classifica uma mensagem do cliente:
-- urgent | question | request | closing | greeting | social | audio | media | plain
create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
returns text
language sql stable set search_path = public
as $$
  select case
    when p_type in ('sticker', 'reaction') then 'closing'
    when p_type = 'audio' then 'audio'
    when nullif(btrim(coalesce(p_body, '')), '') is null then
      case when p_type in ('image', 'video', 'document') then 'media' else 'plain' end
    when public.match_keyword(p_body, p->'urgent_keywords') is not null then 'urgent'
    when p_body ~ '[?¿]'
      or public.norm_text(btrim(p_body)) ~ ('^(quem|qual|quais|quando|onde|como|quanto|quantos|quantas|por que|porque|pq|'
           || 'sera que|alguem|voces|vcs|tem como|teria como|consegue|conseguem|poderia|poderiam|pode(?! deixar)|podem|'
           || 'da pra|da para|e possivel|seria possivel|existe|ha como|tem previsao)([^[:alnum:]]|$)') then 'question'
    when public.match_keyword(p_body, p->'request_keywords') is not null then 'request'
    when public.norm_text(btrim(p_body)) ~ ('^(bom dia|boa tarde|boa noite|oi+|ola|opa|e ai|salve|oie)'
           || '([ ,!.]+(pessoal|a todos|todos|gente|galera|tudo bem|tudo bom|como vai))*[ !.,]*$') then 'greeting'
    when public.match_keyword(p_body, p->'closing_keywords') is not null and length(btrim(p_body)) <= 80 then 'closing'
    -- só emojis/pontuação
    when p_body !~ '[[:alnum:]]' then 'closing'
    -- risadas
    when public.norm_text(btrim(p_body)) ~ '^((k|ha|he|hi|rs|ks)+[ !.]*)+$' then 'social'
    else 'plain'
  end
$$;

-- Uma linha por grupo com mensagens de cliente depois da última da equipe
create or replace function public.ind_reply_analysis(f jsonb, p jsonb)
returns table (
  group_id uuid, group_name text, verdict text, priority text, reason text, quote text, client_name text,
  msgs int, clients int, first_at timestamptz, last_at timestamptz, waiting_seconds int, overdue boolean, signals text
)
language sql stable set search_path = public
as $$
  with g as (
    select g.id, g.name, coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s,
           (select max(t.sent_at) from public.messages t where t.group_id = g.id and t.from_team) as last_team_at
    from public.groups g cross join public.app_settings s
    where g.monitored and g.removed_at is null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
      and g.last_client_message_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
  ),
  -- últimas N mensagens do cliente depois da última mensagem da equipe
  m as (
    select g.id as group_id, g.name as group_name, g.sla_s, g.last_team_at, x.*,
           public.reply_signal(x.body, x.message_type, p) as sig,
           row_number() over (partition by g.id order by x.sent_at desc) as rn
    from g
    cross join lateral (
      select c.id, c.body, c.message_type, c.sent_at,
             coalesce(c.sender_name, c.sender_phone, 'Cliente') as who, coalesce(c.sender_jid, c.sender_phone) as who_key
      from public.messages c
      where c.group_id = g.id and not c.from_team
        and c.sent_at > coalesce(g.last_team_at, '-infinity')
        and c.sent_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
      order by c.sent_at desc
      limit greatest(coalesce((p->>'max_messages')::int, 8), 1)
    ) x
  ),
  -- a última mensagem da equipe terminou com pergunta ao cliente?
  team_q as (
    select g.id as group_id,
           coalesce((select t.body ~ '[?¿]' from public.messages t
                     where t.group_id = g.id and t.from_team order by t.sent_at desc limit 1), false) as asked
    from g
  ),
  agg as (
    select m.group_id, min(m.group_name) as group_name, min(m.sla_s) as sla_s,
           count(*)::int as msgs, count(distinct m.who_key)::int as clients,
           min(m.sent_at) as first_at, max(m.sent_at) as last_at,
           (array_agg(m.sig order by m.sent_at desc))[1] as last_sig,
           (array_agg(m.body order by m.sent_at desc))[1] as last_body,
           (array_agg(m.who order by m.sent_at desc))[1] as last_who,
           bool_or(m.sig = 'urgent') as has_urgent,
           bool_or(m.sig = 'question') as has_question,
           bool_or(m.sig = 'request') as has_request,
           count(*) filter (where m.sig in ('urgent', 'question', 'request'))::int as asks,
           min(m.sent_at) filter (where m.sig in ('urgent', 'question', 'request')) as first_ask_at,
           -- mensagem que motivou a decisão: a mais recente com o sinal mais forte
           (array_agg(m.body order by case m.sig when 'urgent' then 0 when 'question' then 1 when 'request' then 2 else 9 end, m.sent_at desc))[1] as top_body,
           (array_agg(m.who order by case m.sig when 'urgent' then 0 when 'question' then 1 when 'request' then 2 else 9 end, m.sent_at desc))[1] as top_who,
           string_agg(distinct case m.sig when 'urgent' then 'urgência' when 'question' then 'pergunta' when 'request' then 'pedido'
                                   when 'closing' then 'encerramento' when 'greeting' then 'cumprimento' when 'social' then 'conversa'
                                   when 'audio' then 'áudio' when 'media' then 'arquivo' else 'texto' end, ', ') as signals
    from m
    group by m.group_id
  ),
  d as (
    select a.*, tq.asked as team_asked,
      case
        when a.last_sig = 'closing' and a.asks > 0 then 'check'
        when a.last_sig = 'closing' then 'no'
        when a.has_urgent or a.has_question or a.has_request then 'needs'
        when a.last_sig = 'plain' and tq.asked then 'needs'
        when a.last_sig in ('audio', 'media', 'greeting') then 'check'
        else 'no'
      end as verdict
    from agg a join team_q tq on tq.group_id = a.group_id
  ),
  w as (
    select d.*,
           -- espera contada desde o primeiro pedido/pergunta sem resposta (ou a primeira mensagem da sequência)
           case when d.verdict = 'needs' and d.asks > 0 then d.first_ask_at else d.first_at end as since
    from d
  ),
  w2 as (
    select w.*, extract(epoch from now() - w.since)::int as waiting,
           (case when public.sla_business_time_only() then public.business_seconds(w.since, now(), f)
                 else extract(epoch from now() - w.since)::int end) > w.sla_s as late
    from w
  )
  select group_id, group_name, verdict,
         case when verdict <> 'needs' then 'normal'
              when has_urgent or late or asks >= 3 then 'alta' else 'normal' end,
         case
           when verdict = 'needs' and has_urgent then 'Problema ou urgência'
           when verdict = 'needs' and has_question then 'Pergunta sem resposta'
           when verdict = 'needs' and has_request then 'Pedido sem resposta'
           when verdict = 'needs' then 'Respondeu à pergunta da equipe'
           when verdict = 'check' and last_sig = 'closing' then 'Encerrou, mas antes pediu ou perguntou algo'
           when verdict = 'check' and last_sig = 'audio' then 'Áudio: ouça para saber se precisa de resposta'
           when verdict = 'check' and last_sig = 'media' then 'Enviou arquivo sem texto'
           when verdict = 'check' then 'Só cumprimento, pode estar esperando atenção'
           when last_sig = 'closing' then 'Cliente agradeceu ou encerrou'
           when last_sig = 'social' then 'Conversa social (risadas, emojis)'
           else 'Sem pergunta, pedido ou problema'
         end
         || case when verdict = 'needs' and asks >= 2 then ' · insistiu ' || asks || 'x' else '' end,
         left(coalesce(case when verdict = 'needs' and asks > 0 then top_body else last_body end, '[mídia]'), 160),
         case when verdict = 'needs' and asks > 0 then top_who else last_who end,
         msgs, clients, first_at, last_at, waiting, late, signals
  from w2
$$;

create or replace function public.ind_analise_sem_resposta(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_reply_analysis(f, p)),
  agg as (
    select count(*) filter (where verdict = 'needs')::int as needs,
           count(*) filter (where verdict = 'needs' and priority = 'alta')::int as high,
           count(*) filter (where verdict = 'check')::int as checks,
           count(*) filter (where verdict = 'no')::int as noes
    from r
  ),
  shown as (
    select * from r
    where verdict = 'needs' or (verdict = 'check' and coalesce((p->>'show_check')::boolean, true))
    order by verdict = 'needs' desc, priority = 'alta' desc, waiting_seconds desc
    limit 50
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', needs,
    'unit', case when needs = 1 then 'grupo precisa de resposta' else 'grupos precisam de resposta' end,
    'tone', case when high > 0 then 'critical' when needs > 0 then 'warning' else 'good' end,
    'hint', case when needs + checks + noes = 0 then 'Nenhuma mensagem de cliente sem resposta da equipe'
                 else 'Análise das últimas mensagens de cada grupo sem resposta da equipe · tempo = espera' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Prioridade alta', 'value', high, 'format', 'number'),
      jsonb_build_object('label', 'Verificar', 'value', checks, 'format', 'number'),
      jsonb_build_object('label', 'Não precisam', 'value', noes, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id,
        'sublabel', reason || ' · “' || left(quote, 70) || case when length(quote) > 70 then '…' else '' end || '”',
        'detail', waiting_seconds, 'detail_format', 'duration',
        'tone', case when verdict = 'check' then null when priority = 'alta' then 'critical' else 'warning' end
      ) order by verdict = 'needs' desc, priority = 'alta' desc, waiting_seconds desc)
      from shown
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 5), 1),
    'list_more', greatest(needs + case when coalesce((p->>'show_check')::boolean, true) then checks else 0 end
                          - (select count(*) from shown), 0)
  )
  from agg
$$;

create or replace function public.ind_analise_sem_resposta_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'verdict_label', 'label', 'Precisa de resposta?'),
      jsonb_build_object('key', 'priority', 'label', 'Prioridade'),
      jsonb_build_object('key', 'reason', 'label', 'Motivo'),
      jsonb_build_object('key', 'quote', 'label', 'Mensagem analisada'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'last_at', 'label', 'Última msg. do cliente', 'format', 'datetime'),
      jsonb_build_object('key', 'msgs', 'label', 'Msgs sem resposta', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'waiting_seconds', 'label', 'Esperando há', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'signals', 'label', 'Sinais encontrados')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name,
      'verdict_label', case verdict when 'needs' then 'Sim' when 'check' then 'Verificar' else 'Não' end,
      'priority', case when verdict = 'needs' then initcap(priority) else '—' end,
      'reason', reason, 'quote', quote, 'client_name', client_name, 'last_at', last_at,
      'msgs', msgs, 'waiting_seconds', waiting_seconds, 'signals', signals
    ) order by case verdict when 'needs' then 0 when 'check' then 1 else 2 end, priority = 'alta' desc, waiting_seconds desc), '[]'::jsonb)
  )
  from public.ind_reply_analysis(f, p)
$$;

-- No catálogo, no bloco Capacidade de resposta
do $$
begin
  if not exists (select 1 from public.indicators where key = 'analise_sem_resposta') then
    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('analise_sem_resposta', 'capacidade_resposta', 'Precisa de resposta?',
       'Analisa as últimas mensagens de cada grupo que ainda não teve resposta da equipe e indica se a conversa precisa de resposta: perguntas, pedidos, problemas e clientes respondendo a uma pergunta da equipe. Agradecimentos, risadas e emojis não contam.',
       6, 'kpi', 2, false, false,
       jsonb_build_object(
         'lookback_days', 7, 'max_messages', 8, 'list_size', 5, 'show_check', true,
         'urgent_keywords', jsonb_build_array('urgente', 'urgência', 'problema', 'erro', 'não funciona', 'não está funcionando',
           'parou', 'travou', 'fora do ar', 'caiu', 'não chegou', 'não recebi', 'atrasado', 'atraso', 'reclamação', 'absurdo',
           'insatisfeito', 'ainda não', 'até agora', 'nada ainda', 'cadê', 'alguém aí', 'aguardando', 'esperando', 'sem resposta',
           'ninguém responde', 'de novo'),
         'request_keywords', jsonb_build_array('preciso', 'precisamos', 'necessito', 'gostaria', 'queria', 'quero', 'por favor',
           'pfv', 'pf', 'favor', 'solicito', 'solicitar', 'me manda', 'me envia', 'manda', 'envia', 'enviar', 'verificar',
           'verifica', 'ajuda', 'ajudar', 'orçamento', 'boleto', 'nota fiscal', 'segunda via', 'cancelar', 'trocar', 'alterar',
           'agendar', 'retorno', 'aguardo', 'me liga', 'ligar', 'segue', 'comprovante', 'paguei', 'pagamento', 'pix', 'transferi'),
         'closing_keywords', jsonb_build_array('obrigado', 'obrigada', 'obg', 'brigado', 'valeu', 'vlw', 'ok', 'okay', 'blz',
           'beleza', 'perfeito', 'combinado', 'show', 'top', 'ótimo', 'entendi', 'certo', 'tudo certo', 'deu certo', 'funcionou',
           'resolvido', 'resolveu', 'recebi', 'chegou', 'joia', 'pode deixar', 'de nada', 'até mais', 'até amanhã', 'abraço', 'tmj', 'fechado')
       ),
       '[{"key":"lookback_days","label":"Analisar conversas dos últimos","type":"int","unit":"dias","min":1,"max":30},
         {"key":"max_messages","label":"Mensagens analisadas por grupo","type":"int","min":2,"max":20,"help":"As mais recentes do cliente depois da última mensagem da equipe."},
         {"key":"list_size","label":"Grupos listados no cartão","type":"int","min":1,"max":15},
         {"key":"show_check","label":"Listar também os casos para verificar (áudio, arquivo, só cumprimento)","type":"bool"},
         {"key":"urgent_keywords","label":"Palavras de problema ou urgência","type":"tags","help":"Deixam a conversa como precisa de resposta, com prioridade alta."},
         {"key":"request_keywords","label":"Palavras de pedido","type":"tags","help":"Indicam que o cliente pediu algo."},
         {"key":"closing_keywords","label":"Palavras de agradecimento ou encerramento","type":"tags","help":"Se a última mensagem do cliente for uma destas, a conversa não precisa de resposta."}]'::jsonb);
    update public.indicators set params = default_params where key = 'analise_sem_resposta';
  end if;
end $$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
revoke all on function public.reply_signal(text, text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0020_media_seen.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Imagens e arquivos sem visualização / sem baixa
--
-- * Cada mensagem do cliente passa a guardar quando foi vista:
--     - no WhatsApp: o celular conectado leu a conversa do grupo (o worker
--       recebe a confirmação de leitura do próprio aparelho);
--     - no painel: alguém deu baixa no arquivo.
-- * O cartão "Imagens e arquivos recebidos" passa a mostrar só os arquivos
--   que ainda ninguém viu nem deu baixa, com o botão de dar baixa.
-- =====================================================================

alter table public.messages add column if not exists seen_at  timestamptz;
alter table public.messages add column if not exists seen_via text;   -- whatsapp | painel | resposta
alter table public.messages add column if not exists seen_by  text;

create index if not exists messages_unseen_media_idx on public.messages (sent_at desc)
  where seen_at is null and not from_team and message_type in ('image', 'video', 'audio', 'document');

-- Arquivos antigos (de antes deste controle) que já tiveram resposta da equipe
-- no grupo depois de enviados contam como vistos.
do $$
begin
  if not exists (select 1 from public.messages where seen_at is not null) then
    update public.messages m
    set seen_at = x.team_at, seen_via = 'resposta'
    from (
      select c.id, (select min(e.sent_at) from public.messages e
                    where e.group_id = c.group_id and e.from_team and e.sent_at >= c.sent_at) as team_at
      from public.messages c
      where not c.from_team and c.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    ) x
    where m.id = x.id and x.team_at is not null;
  end if;
end $$;

-- Worker: o celular conectado leu a conversa do grupo até estas mensagens
-- (sem ids conhecidos, vale tudo o que chegou até p_at).
create or replace function public.mark_group_seen(
  p_instance_id uuid, p_group_jid text, p_wa_ids text[], p_at timestamptz default now()
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
  v_upto  timestamptz;
  v_n     int;
begin
  select id into v_group from public.groups where instance_id = p_instance_id and jid = p_group_jid;
  if v_group is null then
    return 0;
  end if;
  select max(sent_at) into v_upto from public.messages
  where group_id = v_group and wa_message_id = any(coalesce(p_wa_ids, '{}'));
  update public.messages
  set seen_at = coalesce(p_at, now()), seen_via = 'whatsapp', seen_by = 'Número conectado'
  where group_id = v_group and not from_team and seen_at is null
    and sent_at <= coalesce(v_upto, p_at, now());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_group_seen(uuid, text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.mark_group_seen(uuid, text, text[], timestamptz) to service_role;

-- Painel: dar baixa num arquivo (ou em todos os arquivos pendentes do grupo)
create or replace function public.mark_media_seen(p_message_id uuid default null, p_group_id uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_who text;
  v_n   int;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  if p_message_id is null and p_group_id is null then
    raise exception 'informe a mensagem ou o grupo';
  end if;
  select coalesce(nullif(full_name, ''), email) into v_who from public.profiles where id = auth.uid();
  update public.messages
  set seen_at = now(), seen_via = 'painel', seen_by = v_who
  where seen_at is null and not from_team
    and (p_message_id is null or id = p_message_id)
    and (p_group_id is null or group_id = p_group_id)
    and (p_message_id is not null or message_type in ('image', 'video', 'audio', 'document', 'sticker'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_media_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_media_seen(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Indicador: só os arquivos sem visualização/baixa
-- ---------------------------------------------------------------------
drop function if exists public.ind_received_files(jsonb, jsonb);
create function public.ind_received_files(f jsonb, p jsonb)
returns table (
  id uuid, group_id uuid, group_name text, who text, message_type text, body text, sent_at timestamptz, from_team boolean,
  seen_at timestamptz, seen_via text, seen_by text
)
language sql stable set search_path = public
as $$
  select m.id, m.group_id, g.name,
         coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, 'Cliente'),
         m.message_type, m.body, m.sent_at, m.from_team, m.seen_at, m.seen_via, m.seen_by
  from public.messages m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
  where g.monitored and g.removed_at is null
    and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    -- fila de trabalho: os últimos N dias, independente do período do dashboard
    and m.sent_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
    and m.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    and (m.message_type <> 'sticker' or coalesce((p->>'include_stickers')::boolean, false))
    and (coalesce((p->>'include_team')::boolean, false) or not m.from_team)
$$;

create or replace function public.ind_arquivos_recebidos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_received_files(f, p)),
  u as (select * from r where seen_at is null),
  agg as (
    select (select count(*) from u)::int as n,
           (select count(*) from u where message_type = 'image')::int as images,
           (select count(*) from u where message_type = 'document')::int as documents,
           (select count(*) from u where message_type = 'video')::int as videos,
           (select count(*) from u where message_type = 'audio')::int as audios,
           (select count(distinct group_id) from u)::int as groups,
           (select count(*) from r where seen_at is not null)::int as seen,
           (select max(extract(epoch from now() - sent_at)) from u)::int as oldest
  ),
  -- os 30 mais antigos primeiro (quem espera há mais tempo); o cartão mostra list_size
  latest as (select * from u order by sent_at limit 30)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'arquivo sem visualização' else 'arquivos sem visualização' end,
    'tone', case when n = 0 then 'good'
                 when oldest > coalesce((p->>'alert_hours')::int, 4) * 3600 then 'critical' else 'warning' end,
    'hint', case when n = 0 then 'Todos os arquivos dos últimos ' || coalesce(p->>'lookback_days', '7') || ' dias foram vistos'
                 else 'em ' || groups || ' grupo(s) · ninguém leu a conversa no WhatsApp nem deu baixa no painel' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Imagens', 'value', images, 'format', 'number'),
      jsonb_build_object('label', 'Documentos', 'value', documents, 'format', 'number'),
      jsonb_build_object('label', 'Vídeos', 'value', videos, 'format', 'number'),
      jsonb_build_object('label', 'Áudios', 'value', audios, 'format', 'number'),
      jsonb_build_object('label', 'Já vistos', 'value', seen, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'icon', message_type,
        'label', coalesce(nullif(btrim(body), ''),
                          case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo'
                                            when 'audio' then 'Áudio' when 'document' then 'Documento' else 'Figurinha' end),
        'sublabel', group_name || ' · ' || who,
        'group_id', group_id,
        'ack_id', id,
        'detail', sent_at, 'detail_format', 'datetime',
        'tone', case when extract(epoch from now() - sent_at) > coalesce((p->>'alert_hours')::int, 4) * 3600
                     then 'critical' else 'warning' end
      ) order by sent_at)
      from latest
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 6), 1),
    'list_more', greatest(n - (select count(*) from latest), 0)
  )
  from agg
$$;

create or replace function public.ind_arquivos_recebidos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Recebido em', 'format', 'datetime'),
      jsonb_build_object('key', 'kind', 'label', 'Tipo'),
      jsonb_build_object('key', 'body', 'label', 'Arquivo / legenda'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Enviado por'),
      jsonb_build_object('key', 'status', 'label', 'Situação'),
      jsonb_build_object('key', 'seen_at', 'label', 'Visto em', 'format', 'datetime'),
      jsonb_build_object('key', 'seen_by', 'label', 'Visto por')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'kind', case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(body, 200), '—'),
      'status', case when seen_at is null then 'Sem visualização'
                     when seen_via = 'whatsapp' then 'Visto no WhatsApp'
                     when seen_via = 'painel' then 'Baixa no painel'
                     else 'Equipe respondeu depois' end,
      'seen_at', seen_at, 'seen_by', seen_by
    ) order by seen_at is not null, sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_received_files(f, p) order by seen_at is not null, sent_at desc limit 500) x
$$;

update public.indicators
set name = 'Imagens e arquivos sem visualização',
    description = 'Imagens, documentos, vídeos e áudios enviados pelos clientes que ninguém viu: a conversa não foi lida no celular conectado e ninguém deu baixa no painel.',
    default_params = default_params || '{"lookback_days": 7, "alert_hours": 4}',
    params = params || jsonb_build_object(
      'lookback_days', coalesce(params->'lookback_days', '7'::jsonb),
      'alert_hours', coalesce(params->'alert_hours', '4'::jsonb)),
    param_schema = (select jsonb_agg(e) from jsonb_array_elements(param_schema) e where e->>'key' not in ('lookback_days', 'alert_hours'))
      || '[{"key":"lookback_days","label":"Considerar arquivos dos últimos","type":"int","unit":"dias","min":1,"max":60},
           {"key":"alert_hours","label":"Destacar em vermelho depois de","type":"int","unit":"horas","min":1,"max":168}]'::jsonb
where key = 'arquivos_recebidos';

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0021_conversations.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Início e fechamento das conversas nos grupos
--
-- Uma conversa começa com a primeira mensagem que pede atenção quando não
-- há conversa aberta no grupo (do cliente; da equipe também, se o
-- parâmetro permitir). Ela fecha com:
--  * mensagem de ENCERRAMENTO: o cliente agradece/confirma ("obrigado",
--    "deu certo") depois de a equipe participar, ou a equipe encerra
--    ("qualquer dúvida estamos à disposição", "resolvido");
--  * COMPROMISSO DE RETORNO da equipe ("vou verificar e te retorno",
--    "te aviso assim que"). Para esses, a análise mostra se a equipe
--    voltou a falar no grupo depois (retorno cumprido).
-- Se o grupo fica parado mais que o limite (padrão 24 h) sem fechamento,
-- a conversa conta como "sem fechamento".
-- =====================================================================

-- Palavras de compromisso e de encerramento da equipe (parâmetros do indicador)
create or replace function public.team_close_kind(p_body text, p jsonb)
returns text
language sql stable set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_body, '')), '') is null then null
    when public.match_keyword(p_body, p->'commitment_keywords') is not null then 'compromisso'
    when public.match_keyword(p_body, p->'team_closing_keywords') is not null then 'encerramento'
  end
$$;

create or replace function public.ind_conversations(f jsonb, p jsonb)
returns table (
  group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text,
  first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text,
  last_at timestamptz, msgs int, returned_at timestamptz
)
language plpgsql stable set search_path = public
as $$
declare
  -- palavras de pergunta/pedido/urgência/encerramento do cliente vêm da análise "Precisa de resposta?"
  v_sig_p jsonb := coalesce((select i.params from public.indicators i where i.key = 'analise_sem_resposta'), '{}'::jsonb)
                   || case when jsonb_typeof(p->'client_closing_keywords') = 'array'
                                and jsonb_array_length(p->'client_closing_keywords') > 0
                           then jsonb_build_object('closing_keywords', p->'client_closing_keywords') else '{}'::jsonb end;
  v_idle interval := make_interval(hours => coalesce((p->>'idle_hours')::int, 24));
  v_team_starts boolean := coalesce((p->>'team_can_start')::boolean, true);
  m record;
  v_group uuid := null;
  v_open boolean := false;
  v_sig text;
  v_kind text;
  -- o grupo tem compromisso de retorno ainda não cumprido (a próxima mensagem da equipe é o retorno)
  v_awaiting_return boolean := false;
begin
  for m in
    select s.group_id as gid, s.group_name as gname, s.from_team, s.body, s.message_type, s.sent_at,
           coalesce(tm.name, s.sender_name, s.sender_phone, case when s.from_me then 'Número conectado' end,
                    case when s.from_team then 'Equipe' else 'Cliente' end) as who
    from public.ind_scope(f) s
    left join public.team_members tm on tm.id = s.team_member_id
    order by s.group_id, s.sent_at
  loop
    -- mudou de grupo: a conversa aberta do grupo anterior termina como está
    if v_group is distinct from m.gid then
      if v_open then
        status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
        return next;
      end if;
      v_group := m.gid;
      v_open := false;
      v_awaiting_return := false;
    end if;

    -- grupo parado além do limite: a conversa ficou sem fechamento
    if v_open and m.sent_at - last_at > v_idle then
      status := 'sem_fechamento';
      return next;
      v_open := false;
    end if;

    if m.from_team then
      v_kind := public.team_close_kind(m.body, p);
      v_sig := null;
    else
      v_sig := public.reply_signal(m.body, m.message_type, v_sig_p);
      v_kind := null;
    end if;

    if not v_open then
      -- a primeira mensagem da equipe depois de um compromisso é o retorno, não uma conversa nova
      if v_awaiting_return then
        v_awaiting_return := false;
        if m.from_team then
          continue;
        end if;
      end if;
      -- começa uma conversa: mensagem do cliente que não seja agradecimento/risada,
      -- ou da equipe (se permitido) que não seja encerramento/compromisso
      if (not m.from_team and v_sig not in ('closing', 'social'))
         or (m.from_team and v_team_starts and v_kind is null) then
        v_open := true;
        group_id := m.gid; group_name := m.gname; started_at := m.sent_at;
        started_by := case when m.from_team then 'equipe' else 'cliente' end;
        starter := m.who; start_body := m.body;
        first_team_at := case when m.from_team then m.sent_at end;
        closed_at := null; closed_by := null; closer := null; close_body := null; returned_at := null;
        last_at := m.sent_at; msgs := 1;
      end if;
      continue;
    end if;

    msgs := msgs + 1;
    last_at := m.sent_at;
    if m.from_team and first_team_at is null and started_by = 'cliente' then
      first_team_at := m.sent_at;
    end if;

    if (m.from_team and v_kind is not null)
       -- o cliente encerra depois de a equipe ter participado (ou numa conversa iniciada pela equipe)
       or (not m.from_team and v_sig = 'closing' and (first_team_at is not null or started_by = 'equipe')) then
      status := case when v_kind = 'compromisso' then 'compromisso' else 'encerrada' end;
      closed_at := m.sent_at;
      closed_by := case when m.from_team then 'equipe' else 'cliente' end;
      closer := m.who;
      close_body := m.body;
      if status = 'compromisso' then
        -- a equipe voltou a falar no grupo depois do compromisso?
        select min(x.sent_at) into returned_at from public.messages x
        where x.group_id = m.gid and x.from_team and x.sent_at > m.sent_at;
      end if;
      return next;
      v_open := false;
      v_awaiting_return := status = 'compromisso';
    end if;
  end loop;

  if v_open then
    status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
    return next;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Cartão: conversas iniciadas e como fecharam
-- ---------------------------------------------------------------------
create or replace function public.ind_conversas_ciclo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (select * from public.ind_conversations(f, p)),
  agg as (
    select count(*)::int as n,
           count(*) filter (where status = 'encerrada')::int as closed,
           count(*) filter (where status = 'compromisso')::int as promised,
           count(*) filter (where status = 'compromisso' and returned_at is null)::int as promised_pending,
           count(*) filter (where status = 'aberta')::int as open,
           count(*) filter (where status = 'sem_fechamento')::int as unclosed,
           round(avg(extract(epoch from closed_at - started_at)) filter (where closed_at is not null)) as avg_close
    from c
  ),
  v as (select agg.*, case when n > 0 then round(100.0 * (closed + promised) / n, 1) end as pct from agg),
  trend as (
    select to_char((started_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(100.0 * count(*) filter (where status in ('encerrada', 'compromisso')) / count(*), 1) as value
    from c group by 1 order by 1
  ),
  -- o que ainda pede ação: em aberto, retorno prometido e ainda não feito, e as que ficaram sem fechamento
  pending as (
    select *, case when status = 'aberta' then 0 when status = 'compromisso' then 1 else 2 end as ord
    from c where status in ('aberta', 'sem_fechamento') or (status = 'compromisso' and returned_at is null)
    order by ord, started_at
    limit 50
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'conversa iniciada' else 'conversas iniciadas' end,
    'tone', case when n = 0 or pct is null then null
                 when pct >= coalesce((p->>'target_percent')::numeric, 80) then 'good'
                 when pct >= coalesce((p->>'target_percent')::numeric, 80) - 15 then 'warning'
                 else 'critical' end,
    'hint', case when n = 0 then 'Nenhuma conversa iniciada no período'
                 else coalesce(pct::text, '0') || '% fechadas (encerramento ou compromisso de retorno)'
                      || case when avg_close is not null then ' · tempo médio até fechar: '
                              || case when avg_close >= 3600 then floor(avg_close / 3600) || 'h' || lpad((floor(avg_close / 60)::int % 60)::text, 2, '0')
                                      else greatest(1, round(avg_close / 60)) || ' min' end
                              else '' end end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Encerradas', 'value', closed, 'format', 'number'),
      jsonb_build_object('label', 'Compromisso de retorno', 'value', promised, 'format', 'number'),
      jsonb_build_object('label', 'Retorno pendente', 'value', promised_pending, 'format', 'number'),
      jsonb_build_object('label', 'Em aberto', 'value', open, 'format', 'number'),
      jsonb_build_object('label', 'Sem fechamento', 'value', unclosed, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id,
        'sublabel', case status when 'sem_fechamento' then 'Sem fechamento · ' || starter || ': “'
                                    || left(coalesce(start_body, '[mídia]'), 60)
                                when 'compromisso' then 'Retorno pendente · ' || closer || ': “' || left(coalesce(close_body, ''), 60)
                                else 'Em aberto · ' || starter || ': “' || left(coalesce(start_body, '[mídia]'), 60) end
                    || case when length(coalesce(case when status = 'compromisso' then close_body else start_body end, '')) > 60
                            then '…' else '' end || '”',
        -- tempo: desde o início (aberta/sem fechamento) ou desde o compromisso
        'detail', extract(epoch from now() - coalesce(case when status = 'compromisso' then closed_at end, started_at))::int,
        'detail_format', 'duration',
        'tone', case when status = 'aberta' then 'warning' else 'critical' end
      ) order by ord, started_at)
      from pending
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 4), 1),
    'list_more', greatest(open + unclosed + promised_pending - (select count(*) from pending), 0),
    'trend', jsonb_build_object('format', 'percent', 'label', '% fechadas',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from v
$$;

create or replace function public.ind_conversas_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    -- uma linha por conversa, sem agrupar
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'starter', 'label', 'Iniciada por'),
      jsonb_build_object('key', 'started_at', 'label', 'Início', 'format', 'datetime'),
      jsonb_build_object('key', 'status_label', 'label', 'Situação'),
      jsonb_build_object('key', 'closed_at', 'label', 'Fechamento', 'format', 'datetime'),
      jsonb_build_object('key', 'duration', 'label', 'Duração', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'msgs', 'label', 'Mensagens', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'returned', 'label', 'Retorno do compromisso')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name, 'started_at', started_at,
      'starter', starter || case when started_by = 'equipe' then ' (equipe)' else '' end,
      'start_body', left(coalesce(start_body, '[mídia]'), 200),
      'status_label', case status when 'encerrada' then 'Encerrada' when 'compromisso' then 'Compromisso de retorno'
                                  when 'aberta' then 'Em aberto' else 'Sem fechamento' end,
      'closed', case when closed_at is not null then 'Sim' else 'Não' end,
      'closed_at', closed_at, 'closer', closer, 'close_body', left(close_body, 200),
      'duration', case when closed_at is not null then extract(epoch from closed_at - started_at)::int
                       else extract(epoch from last_at - started_at)::int end,
      'msgs', msgs,
      'returned', case when status <> 'compromisso' then null
                       when returned_at is null then 'Pendente'
                       else 'Retornou ' || to_char(returned_at at time zone (f->>'tz'), 'DD/MM HH24:MI') end
    ) order by started_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_conversations(f, p) order by started_at desc limit 500) x
$$;

create or replace function public.ind_conversas_ciclo_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_conversas_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Gráfico: conversas iniciadas x fechadas por dia
-- (usa os parâmetros do cartão de ciclo, para as duas análises baterem)
-- ---------------------------------------------------------------------
create or replace function public.ind_conversas_por_dia(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (
    select * from public.ind_conversations(f,
      coalesce((select i.params from public.indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb))
  ),
  days as (
    select to_char(d, 'YYYY-MM-DD') as x
    from generate_series(((f->>'from')::timestamptz at time zone (f->>'tz'))::date,
                         (((f->>'to')::timestamptz - interval '1 second') at time zone (f->>'tz'))::date,
                         interval '1 day') d
  ),
  s as (select to_char((started_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as n from c group by 1),
  e as (select to_char((closed_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
               count(*) filter (where status = 'encerrada') as closed,
               count(*) filter (where status = 'compromisso') as promised
        from c where closed_at is not null group by 1),
  u as (select to_char((last_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as n
        from c where status = 'sem_fechamento' group by 1)
  select jsonb_build_object(
    'visual', 'series',
    'format', 'number',
    'series', jsonb_build_array(
      jsonb_build_object('key', 'started', 'label', 'Iniciadas'),
      jsonb_build_object('key', 'closed', 'label', 'Encerradas'),
      jsonb_build_object('key', 'promised', 'label', 'Compromisso de retorno'),
      jsonb_build_object('key', 'unclosed', 'label', 'Sem fechamento')
    ),
    'data', coalesce(jsonb_agg(jsonb_build_object(
      'x', days.x,
      'started', coalesce(s.n, 0), 'closed', coalesce(e.closed, 0),
      'promised', coalesce(e.promised, 0), 'unclosed', coalesce(u.n, 0)
    ) order by days.x), '[]'::jsonb)
  )
  from days
  left join s on s.x = days.x
  left join e on e.x = days.x
  left join u on u.x = days.x
$$;

create or replace function public.ind_conversas_por_dia_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_conversas_details(f, coalesce((select i.params from public.indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb)) $$;

-- ---------------------------------------------------------------------
-- Catálogo: novo bloco "Ciclo das conversas"
-- ---------------------------------------------------------------------
insert into public.indicator_blocks (key, name, description, position) values
  ('ciclo_conversas', 'Ciclo das conversas', 'Quando as conversas começam nos grupos e como terminam: encerramento ou compromisso de retorno.', 2)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.indicators where key = 'conversas_ciclo') then
    -- abre espaço logo depois de Capacidade de resposta
    update public.indicator_blocks set position = position + 1 where key <> 'ciclo_conversas' and position >= 2;

    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('conversas_ciclo', 'ciclo_conversas', 'Início e fechamento das conversas',
       'Conta as conversas iniciadas nos grupos e como cada uma terminou: com mensagem de encerramento (o cliente agradece ou confirma, ou a equipe encerra) ou com compromisso de retorno da equipe ("vou verificar e te retorno"). Conversas paradas além do limite sem fechamento contam como "sem fechamento". A lista mostra as que ainda não fecharam.',
       1, 'kpi', 2, false, false,
       jsonb_build_object(
         'idle_hours', 24, 'target_percent', 80, 'list_size', 4, 'team_can_start', true,
         'commitment_keywords', jsonb_build_array('vou verificar', 'vamos verificar', 'vou ver', 'vamos ver', 'vou checar',
           'vamos checar', 'vou analisar', 'vamos analisar', 'te retorno', 'retorno em', 'retorno até', 'já retorno',
           'retornamos', 'retorno assim que', 'te aviso', 'aviso assim que', 'assim que tiver', 'assim que possível',
           'vou providenciar', 'vamos providenciar', 'vou encaminhar', 'vamos encaminhar', 'vou resolver', 'vamos resolver',
           'até amanhã te', 'ainda hoje'),
         'team_closing_keywords', jsonb_build_array('qualquer dúvida', 'qualquer coisa', 'estamos à disposição',
           'fico à disposição', 'à disposição', 'disponha', 'resolvido', 'finalizado', 'concluído', 'por nada',
           'tenha um bom dia', 'tenha uma boa tarde', 'tenha uma boa noite', 'bom fim de semana', 'ótimo dia')
       ),
       '[{"key":"idle_hours","label":"Conversa parada vira \"sem fechamento\" depois de","type":"int","unit":"horas","min":1,"max":168},
         {"key":"target_percent","label":"Meta de conversas fechadas","type":"int","unit":"%","min":1,"max":100},
         {"key":"list_size","label":"Conversas listadas no cartão","type":"int","min":1,"max":15},
         {"key":"team_can_start","label":"Contar conversas iniciadas pela equipe","type":"bool"},
         {"key":"commitment_keywords","label":"Palavras de compromisso de retorno (equipe)","type":"tags","help":"Mensagem da equipe com uma destas palavras fecha a conversa como compromisso de retorno."},
         {"key":"team_closing_keywords","label":"Palavras de encerramento da equipe","type":"tags","help":"Mensagem da equipe com uma destas palavras encerra a conversa."},
         {"key":"client_closing_keywords","label":"Palavras de encerramento do cliente","type":"tags","help":"Agradecimento ou confirmação do cliente encerra a conversa depois que a equipe participou. Vazio = usar as do indicador \"Precisa de resposta?\"."}]'::jsonb);
    update public.indicators set params = default_params where key = 'conversas_ciclo';

    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('conversas_por_dia', 'ciclo_conversas', 'Conversas por dia',
       'Conversas iniciadas, encerradas, fechadas com compromisso de retorno e sem fechamento, dia a dia. Usa as mesmas regras do cartão "Início e fechamento das conversas".',
       2, 'series', 2, false, false, '{}'::jsonb, '[]'::jsonb);
    update public.indicators set params = default_params where key = 'conversas_por_dia';
  end if;
end $$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
revoke all on function public.team_close_kind(text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 0022_daily.sql <<<<<<<<<<<<<<<<<<<<
-- =====================================================================
-- Acompanhamento do dia
--
-- Novo bloco, no topo do dashboard, para acompanhar o dia de perto:
--  * O dia hora a hora: mensagens recebidas, respondidas e pendentes ao
--    fim de cada hora (num período de vários dias, uma barra por dia).
--  * Tempo de resposta hora a hora: média e pior tempo em cada hora.
--  * Grupos no dia: cada grupo numa linha com o que aconteceu no período
--    e o que está pendente agora.
-- =====================================================================

-- Faixas de horário do período: horas (um dia só) ou dias (vários dias)
create or replace function public.ind_slots(f jsonb)
returns table (t0 timestamp, t1 timestamp, x text, hourly boolean)
language sql stable set search_path = public
as $$
  with b as (
    select (f->>'from')::timestamptz at time zone (f->>'tz') as d0,
           ((f->>'to')::timestamptz - interval '1 second') at time zone (f->>'tz') as d1,
           (f->>'to')::timestamptz - (f->>'from')::timestamptz <= interval '25 hours' as hourly
  )
  select s, s + case when hourly then interval '1 hour' else interval '1 day' end,
         case when hourly then to_char(s, 'HH24') || 'h' else to_char(s, 'YYYY-MM-DD') end,
         hourly
  from b, generate_series(date_trunc(case when hourly then 'hour' else 'day' end, d0),
                          date_trunc(case when hourly then 'hour' else 'day' end, d1),
                          case when hourly then interval '1 hour' else interval '1 day' end) s
$$;

-- ---------------------------------------------------------------------
-- O dia hora a hora
-- ---------------------------------------------------------------------
create or replace function public.ind_dia_hora_a_hora(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with s as (select * from public.ind_slots(f)),
  -- mensagens de cliente no período, com quando a equipe respondeu no grupo
  c as (
    select m.sent_at at time zone (f->>'tz') as lt,
           (select min(t.sent_at) from public.messages t
             where t.group_id = m.group_id and t.from_team and t.sent_at >= m.sent_at) at time zone (f->>'tz') as ans_lt,
           m.opens_pending
    from public.ind_scope(f) m
    where not m.from_team
  ),
  r as (select sent_at at time zone (f->>'tz') as lt from public.ind_responses(f)),
  v as (
    select s.x, s.t0, s.hourly,
           (select count(*) from c where c.lt >= s.t0 and c.lt < s.t1)::int as received,
           (select count(*) from r where r.lt >= s.t0 and r.lt < s.t1)::int as answered,
           -- pendentes ao fim da faixa (ou agora, na faixa em andamento)
           (select count(*) from c where c.opens_pending and c.lt < s.t1
                                     and (c.ans_lt is null or c.ans_lt >= least(s.t1, now() at time zone (f->>'tz'))))::int as pending
    from s
  ),
  peak as (select x, received from v order by received desc, t0 limit 1)
  select jsonb_build_object(
    -- um dia: barras por hora; vários dias: linha por dia
    'visual', case when (select hourly from v limit 1) then 'bars' else 'series' end,
    'format', 'number',
    'hint', case when (select sum(received) from v) = 0 then 'Nenhuma mensagem de cliente no período'
                 else 'Pico: ' || (select case when (select hourly from v limit 1) then x else to_char(x::date, 'DD/MM') end from peak)
                      || ' (' || (select received from peak) || ' recebidas) · '
                      || (select sum(received) from v) || ' recebidas · ' || (select sum(answered) from v) || ' respostas' end,
    'series', jsonb_build_array(
      jsonb_build_object('key', 'received', 'label', 'Recebidas'),
      jsonb_build_object('key', 'answered', 'label', 'Respostas da equipe'),
      jsonb_build_object('key', 'pending', 'label', case when (select hourly from v limit 1)
                                                         then 'Pendentes no fim da hora' else 'Pendentes no fim do dia' end)
    ),
    'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'label', x, 'received', received, 'answered', answered, 'pending', pending)
                                       order by t0) from v), '[]'::jsonb)
  )
$$;

create or replace function public.ind_dia_hora_a_hora_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- duração legível (usada nas frases-resumo)
create or replace function public.fmt_duration(s int)
returns text
language sql immutable
as $$
  select case when s is null then '—'
              when s < 60 then s || 's'
              when s < 3600 then round(s / 60.0) || ' min'
              when s < 86400 then floor(s / 3600) || 'h' || lpad((floor(s / 60)::int % 60)::text, 2, '0')
              else floor(s / 86400) || 'd ' || (floor(s / 3600)::int % 24) || 'h' end
$$;

-- ---------------------------------------------------------------------
-- Tempo de resposta hora a hora
-- ---------------------------------------------------------------------
create or replace function public.ind_tempo_resposta_hora(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with s as (select * from public.ind_slots(f)),
  r as (select sent_at at time zone (f->>'tz') as lt, response_time_seconds as t from public.ind_responses(f)),
  v as (
    select s.x, s.t0,
           (select round(avg(t)) from r where r.lt >= s.t0 and r.lt < s.t1) as avg_s,
           (select max(t) from r where r.lt >= s.t0 and r.lt < s.t1) as max_s
    from s
  ),
  worst as (select x, avg_s from v where avg_s is not null order by avg_s desc limit 1)
  select jsonb_build_object(
    'visual', case when (select hourly from s limit 1) then 'bars' else 'series' end,
    'format', 'duration',
    'hint', coalesce('Mais lento: ' || (select case when (select hourly from s limit 1) then x else to_char(x::date, 'DD/MM') end
                                       || ' (média ' || public.fmt_duration(avg_s::int) || ')' from worst)
                     || ' · SLA ' || coalesce((select default_sla_minutes from public.app_settings where id = 1), 30) || ' min',
                     'Nenhuma resposta no período'),
    'series', jsonb_build_array(
      jsonb_build_object('key', 'avg_s', 'label', 'Tempo médio'),
      jsonb_build_object('key', 'max_s', 'label', 'Pior tempo')
    ),
    'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'label', x, 'avg_s', avg_s, 'max_s', max_s) order by t0) from v), '[]'::jsonb)
  )
$$;

create or replace function public.ind_tempo_resposta_hora_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_responses_details(f, p) $$;


-- ---------------------------------------------------------------------
-- Grupos no dia
-- ---------------------------------------------------------------------
create or replace function public.ind_dia_por_grupo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with o as (select public.sla_business_time_only() as useful),
  m as (
    select group_id, group_name,
           count(*) filter (where not from_team)::int as received,
           count(*) filter (where from_team)::int as team_msgs,
           min(sent_at) filter (where not from_team) as first_at,
           max(sent_at) as last_at
    from public.ind_scope(f) group by group_id, group_name
  ),
  r as (
    select group_id, count(*)::int as answered, round(avg(response_time_seconds))::int as avg_s,
           round(100.0 * count(*) filter (where (case when o.useful then business_seconds else response_time_seconds end) <= sla_seconds)
                 / nullif(count(*), 0), 1) as sla_pct
    from public.ind_responses(f), o group by group_id
  ),
  g as (
    select g.id, g.name, g.pending_count, g.pending_since
    from public.groups g
    where g.monitored and g.removed_at is null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
  ),
  rows as (
    select g.id as group_id, g.name as group_name,
           coalesce(m.received, 0) as received, coalesce(r.answered, 0) as answered, coalesce(m.team_msgs, 0) as team_msgs,
           g.pending_count as pending_now,
           case when g.pending_since is not null then extract(epoch from now() - g.pending_since)::int end as waiting,
           r.avg_s, r.sla_pct, m.first_at, m.last_at
    from g
    left join m on m.group_id = g.id
    left join r on r.group_id = g.id
    where m.group_id is not null or g.pending_count > 0
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'received', 'label', 'Recebidas', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'answered', 'label', 'Respostas', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'team_msgs', 'label', 'Msgs da equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'avg_s', 'label', 'Tempo médio', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'sla_pct', 'label', 'No SLA', 'format', 'percent', 'align', 'right',
                         'warn_below', coalesce((p->>'sla_warn_percent')::numeric, 80)),
      jsonb_build_object('key', 'pending_now', 'label', 'Pendentes agora', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'waiting', 'label', 'Esperando há', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'first_at', 'label', 'Primeira msg. do cliente', 'format', 'datetime'),
      jsonb_build_object('key', 'last_at', 'label', 'Última mensagem', 'format', 'datetime')
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.pending_now desc, x.waiting desc nulls last, x.received desc)
                      from rows x), '[]'::jsonb)
  )
$$;

create or replace function public.ind_dia_por_grupo_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Catálogo: bloco "Acompanhamento do dia", no topo
-- ---------------------------------------------------------------------
insert into public.indicator_blocks (key, name, description, position) values
  ('acompanhamento_dia', 'Acompanhamento do dia', 'O dia de perto: hora a hora, tempo de resposta em cada hora e o que aconteceu em cada grupo.', 0)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.indicators where key = 'dia_hora_a_hora') then
    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled, default_params, param_schema)
    values
      ('dia_hora_a_hora', 'acompanhamento_dia', 'O dia hora a hora',
       'Mensagens recebidas dos clientes, respostas da equipe e mensagens pendentes no fim de cada hora. Num período de vários dias, mostra um ponto por dia.',
       1, 'series', 2, false, false, '{}'::jsonb, '[]'::jsonb),
      ('tempo_resposta_hora', 'acompanhamento_dia', 'Tempo de resposta hora a hora',
       'Tempo médio e pior tempo de resposta da equipe em cada hora (ou em cada dia, num período de vários dias). Ajuda a ver em que horário o atendimento fica lento.',
       2, 'series', 1, false, false, '{}'::jsonb, '[]'::jsonb),
      ('dia_por_grupo', 'acompanhamento_dia', 'Grupos no dia',
       'Cada grupo numa linha: mensagens recebidas, respostas, tempo médio, SLA, o que está pendente agora e há quanto tempo, primeira mensagem do cliente e última mensagem do período. Os grupos com pendência aparecem primeiro.',
       3, 'table', 3, false, false, '{"sla_warn_percent": 80}'::jsonb,
       '[{"key":"sla_warn_percent","label":"Destacar SLA abaixo de","type":"int","unit":"%","min":1,"max":100}]'::jsonb);
    update public.indicators set params = default_params
    where key in ('dia_hora_a_hora', 'tempo_resposta_hora', 'dia_por_grupo');
  end if;
end $$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência: o SQL Editor mostra esta tabela no final.
-- Todas as linhas com "OK" = banco atualizado.
-- ---------------------------------------------------------------------
select item as "Item", case when ok then 'OK' else 'FALTANDO' end as "Situação"
from (values
  (1, 'Indicadores e configurações (0008)', to_regclass('public.indicators') is not null),
  (2, 'Horário comercial nos indicadores (0009)', to_regprocedure('public.business_seconds(timestamptz,timestamptz,jsonb)') is not null),
  (3, 'Demandas (0010)', to_regclass('public.demands') is not null),
  (4, 'Blocos 3 e 4 de indicadores (0011)', to_regprocedure('public.ind_grupos_silenciosos(jsonb,jsonb)') is not null),
  (5, 'Responder pelo sistema (0012)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'reply_allowed')),
  (6, 'Um worker por vez (0013)', to_regclass('public.worker_lock') is not null),
  (7, 'Reincidência de falta de resposta (0014)', to_regprocedure('public.ind_reincidencia_sem_resposta(jsonb,jsonb)') is not null),
  (8, 'Alerta de reincidência (0015)', exists (select 1 from public.alert_rules where type = 'recurrence')),
  (9, 'Horários de pico com resumo (0016)', (select description like 'Quando os clientes mais escrevem%' from public.indicators where key = 'horarios_pico')),
  (10, 'Pendentes por grupo e arquivos recebidos (0017)', to_regprocedure('public.ind_arquivos_recebidos(jsonb,jsonb)') is not null),
  (11, 'Tempo de resposta desde a última mensagem do cliente (0018)',
      coalesce(obj_description('public.ingest_message(uuid,text,text,text,text,boolean,boolean,uuid,text,text,timestamptz,boolean)'::regprocedure, 'pg_proc') like '%0018%', false)),
  (12, 'Análise "Precisa de resposta?" (0019)', to_regprocedure('public.ind_analise_sem_resposta(jsonb,jsonb)') is not null),
  (13, 'Arquivos sem visualização (0020)', to_regprocedure('public.mark_media_seen(uuid,uuid)') is not null),
  (14, 'Início e fechamento das conversas (0021)', to_regprocedure('public.ind_conversas_ciclo(jsonb,jsonb)') is not null),
  (15, 'Acompanhamento do dia (0022)', to_regprocedure('public.ind_dia_hora_a_hora(jsonb,jsonb)') is not null),
  (16, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
) as t(ord, item, ok)
order by ord;
