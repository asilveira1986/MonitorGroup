-- =====================================================================
-- Multiempresa: o sistema atende várias empresas, cada uma isolada
--
--  * companies: as empresas clientes (ativa/suspensa, limites de grupos
--    e usuários). Quem administra a plataforma (profiles.platform_admin)
--    cadastra empresas, libera ou suspende o acesso e pode entrar em uma
--    empresa para dar suporte.
--  * Toda informação pertence a uma empresa (company_id): grupos,
--    mensagens, conexões do WhatsApp, alertas, regras, demandas, equipe,
--    setores, usuários, feriados, configurações e indicadores.
--  * As regras do banco (RLS) só mostram os dados da empresa de quem
--    está logado; administrador é administrador da própria empresa.
--  * Configurações (app_settings) passam a ser uma linha por empresa; o
--    catálogo de indicadores continua único e cada empresa guarda o que
--    ligou/desligou e seus parâmetros (company_indicators).
--  * Um só worker atende todas as empresas: cada empresa tem as suas
--    conexões do WhatsApp; empresa suspensa é desconectada.
--  * Transição: os dados atuais vão para a primeira empresa (com o nome
--    de Configurações › Geral) e os administradores atuais passam a
--    administrar a plataforma.
-- =====================================================================

-- ------------------------------------------------------------- empresas
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  document     text,
  contact_name text,
  contact_email text,
  contact_phone text,
  active       boolean not null default true,
  max_groups   integer check (max_groups is null or max_groups > 0),
  max_users    integer check (max_users is null or max_users > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.companies enable row level security;

alter table public.profiles
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists platform_admin boolean not null default false;

-- empresa de quem está logado
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

-- empresa do contexto: a do usuário ou, no worker, a informada na sessão (app.company_id)
create or replace function public.ctx_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.current_company_id(), nullif(current_setting('app.company_id', true), '')::uuid)
$$;

-- padrão das colunas company_id: a empresa de quem insere; sem usuário (SQL Editor), a primeira empresa
create or replace function public.default_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.ctx_company_id(), (select id from public.companies order by created_at, id limit 1))
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and platform_admin)
$$;

-- transição: a primeira empresa recebe os dados atuais
do $$
declare
  v_company uuid;
begin
  if not exists (select 1 from public.companies) then
    insert into public.companies (name)
    values (coalesce(nullif((select company_name from public.app_settings order by id limit 1), ''), 'Minha Empresa'))
    returning id into v_company;
    update public.profiles set company_id = v_company where company_id is null;
    -- quem já administrava o sistema passa a administrar a plataforma
    update public.profiles set platform_admin = true where role = 'admin' and active;
  end if;
end $$;

-- ------------------------------------------- company_id em cada tabela
do $$
declare
  t text;
begin
  foreach t in array array['allowed_emails', 'app_settings', 'config_audit', 'groups', 'alerts', 'alert_rules',
                           'demands', 'outgoing_messages', 'team_members', 'whatsapp_instances', 'sectors', 'holidays'] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete cascade', t);
    execute format('update public.%I set company_id = public.default_company_id() where company_id is null', t);
    execute format('alter table public.%I alter column company_id set default public.default_company_id()', t);
    execute format('alter table public.%I alter column company_id set not null', t);
    execute format('create index if not exists %I on public.%I (company_id)', t || '_company_idx', t);
  end loop;
end $$;

-- app_settings: uma linha por empresa
alter table public.app_settings drop constraint if exists app_settings_id_check;
create sequence if not exists public.app_settings_id_seq owned by public.app_settings.id;
select setval('public.app_settings_id_seq', greatest((select max(id) from public.app_settings), 1));
alter table public.app_settings alter column id set default nextval('public.app_settings_id_seq');
create unique index if not exists app_settings_company_key on public.app_settings (company_id);

-- unicidades passam a valer dentro da empresa
alter table public.sectors drop constraint if exists sectors_name_key;
create unique index if not exists sectors_company_name_key on public.sectors (company_id, name);
drop index if exists public.team_members_phone_idx;
drop index if exists public.team_members_jid_idx;
create unique index if not exists team_members_company_phone_idx on public.team_members (company_id, phone) where phone is not null;
create unique index if not exists team_members_company_jid_idx on public.team_members (company_id, jid) where jid is not null;
alter table public.holidays drop constraint if exists holidays_pkey;
do $$ begin
  alter table public.holidays add constraint holidays_pkey primary key (company_id, day);
exception when duplicate_table or invalid_table_definition then null; end $$;

-- demandas numeradas por empresa (#1, #2, ... em cada empresa)
alter table public.demands alter column number drop identity if exists;
alter table public.demands drop constraint if exists demands_number_key;
create unique index if not exists demands_company_number_key on public.demands (company_id, number);

create or replace function public.demands_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('demands:' || new.company_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.demands where company_id = new.company_id;
  end if;
  return new;
end;
$$;

-- a empresa de um registro vem do grupo (ou da conexão): o worker não precisa informar
create or replace function public.fill_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  if tg_table_name = 'groups' then
    select company_id into v_company from public.whatsapp_instances where id = new.instance_id;
  elsif tg_table_name = 'alerts' then
    v_company := coalesce(
      (select company_id from public.groups where id = new.group_id),
      (select company_id from public.whatsapp_instances where id = new.instance_id),
      (select company_id from public.alert_rules where id = new.rule_id));
  else
    select company_id into v_company from public.groups where id = new.group_id;
  end if;
  if v_company is not null then
    new.company_id := v_company;
  end if;
  return new;
end;
$$;

drop trigger if exists groups_fill_company on public.groups;
create trigger groups_fill_company before insert on public.groups
  for each row execute function public.fill_company_id();
drop trigger if exists alerts_fill_company on public.alerts;
create trigger alerts_fill_company before insert on public.alerts
  for each row execute function public.fill_company_id();
drop trigger if exists demands_fill_company on public.demands;
create trigger demands_fill_company before insert on public.demands
  for each row execute function public.fill_company_id();
drop trigger if exists outgoing_fill_company on public.outgoing_messages;
create trigger outgoing_fill_company before insert on public.outgoing_messages
  for each row execute function public.fill_company_id();
-- a numeração roda depois de saber a empresa (gatilhos seguem a ordem alfabética)
drop trigger if exists demands_zz_number on public.demands;
create trigger demands_zz_number before insert on public.demands
  for each row execute function public.demands_number();

-- ------------------------------------------- indicadores por empresa
create table if not exists public.company_indicators (
  company_id    uuid not null references public.companies(id) on delete cascade,
  key           text not null references public.indicators(key) on delete cascade on update cascade,
  enabled       boolean,
  alert_enabled boolean,
  params        jsonb,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (company_id, key)
);
create table if not exists public.company_indicator_blocks (
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null references public.indicator_blocks(key) on delete cascade on update cascade,
  enabled    boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);
alter table public.company_indicators enable row level security;
alter table public.company_indicator_blocks enable row level security;

-- transição: o que estava configurado vira a configuração da primeira empresa
insert into public.company_indicators (company_id, key, enabled, alert_enabled, params, updated_by, updated_at)
select (select id from public.companies order by created_at, id limit 1), key, enabled, alert_enabled, params, updated_by, updated_at
from public.indicators
where not exists (select 1 from public.company_indicators)
on conflict do nothing;
insert into public.company_indicator_blocks (company_id, key, enabled, updated_by, updated_at)
select (select id from public.companies order by created_at, id limit 1), key, enabled, updated_by, updated_at
from public.indicator_blocks
where not exists (select 1 from public.company_indicator_blocks)
on conflict do nothing;

-- catálogo + o estado da empresa do contexto (sem linha da empresa: o padrão do indicador)
create or replace view public.my_indicators with (security_invoker = true) as
  select i.key, i.block_key, i.name, i.description, i.position, i.visual, i.size,
         coalesce(c.enabled, i.default_enabled) as enabled,
         i.supports_alert,
         coalesce(c.alert_enabled, i.default_alert_enabled) as alert_enabled,
         i.has_details,
         i.default_params || coalesce(c.params, '{}'::jsonb) as params,
         i.param_schema, i.default_enabled, i.default_alert_enabled, i.default_params,
         c.updated_by, coalesce(c.updated_at, i.updated_at) as updated_at
  from public.indicators i
  left join public.company_indicators c on c.key = i.key and c.company_id = public.ctx_company_id();

create or replace view public.my_indicator_blocks with (security_invoker = true) as
  select b.key, b.name, b.description, b.position, coalesce(c.enabled, true) as enabled,
         c.updated_by, coalesce(c.updated_at, b.updated_at) as updated_at
  from public.indicator_blocks b
  left join public.company_indicator_blocks c on c.key = b.key and c.company_id = public.ctx_company_id();

grant select on public.my_indicators, public.my_indicator_blocks to authenticated, service_role;

-- parâmetros de um indicador de uma empresa (worker e funções sem usuário)
create or replace function public.company_indicator_params(p_company_id uuid, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select i.default_params || coalesce(c.params, '{}'::jsonb)
  from public.indicators i
  left join public.company_indicators c on c.key = i.key and c.company_id = p_company_id
  where i.key = p_key
$$;

-- os gatilhos de sincronização passam para a tabela da empresa
drop trigger if exists indicators_sync_alert_rules on public.indicators;
drop trigger if exists indicators_sync_sla on public.indicators;
drop trigger if exists audit_indicators on public.indicators;
drop trigger if exists audit_indicator_blocks on public.indicator_blocks;

create or replace function public.sync_indicator_alert_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := public.company_indicator_params(new.company_id, new.key)
                 - array(select jsonb_object_keys(coalesce(new.params, '{}'::jsonb)))
                 || coalesce(case when tg_op = 'UPDATE' then old.params end, '{}'::jsonb);
  v_new jsonb := (select default_params from public.indicators where key = new.key) || coalesce(new.params, '{}'::jsonb);
begin
  if new.key = 'grupos_silenciosos' and (v_new->>'silent_days') is not null
     and (v_new->'silent_days') is distinct from (v_old->'silent_days') then
    update public.alert_rules
    set threshold_minutes = (v_new->>'silent_days')::int * 1440, updated_at = now()
    where company_id = new.company_id and indicator_key = 'grupos_silenciosos' and type = 'inactivity'
      and threshold_minutes = coalesce((v_old->>'silent_days')::int, 3) * 1440;
  end if;
  if new.key = 'cobrancas_reclamacoes' and jsonb_typeof(v_new->'keywords') = 'array'
     and (v_new->'keywords') is distinct from (v_old->'keywords') then
    update public.alert_rules
    set keywords = array(select jsonb_array_elements_text(v_new->'keywords')), updated_at = now()
    where company_id = new.company_id and indicator_key = 'cobrancas_reclamacoes' and type = 'keyword'
      and keywords = array(select jsonb_array_elements_text(coalesce(v_old->'keywords', '[]'::jsonb)));
  end if;
  return new;
end;
$$;

create or replace function public.sync_sla_setting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'taxa_resposta_sla' and (new.params->>'sla_minutes') is not null
     and (tg_op = 'INSERT' or (new.params->'sla_minutes') is distinct from (old.params->'sla_minutes')) then
    update public.app_settings set default_sla_minutes = (new.params->>'sla_minutes')::int, updated_at = now()
    where company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists company_indicators_sync_alert_rules on public.company_indicators;
create trigger company_indicators_sync_alert_rules after insert or update on public.company_indicators
  for each row execute function public.sync_indicator_alert_rules();
drop trigger if exists company_indicators_sync_sla on public.company_indicators;
create trigger company_indicators_sync_sla after insert or update on public.company_indicators
  for each row execute function public.sync_sla_setting();
drop trigger if exists audit_company_indicators on public.company_indicators;
create trigger audit_company_indicators after update on public.company_indicators
  for each row execute function public.audit_config_change();
drop trigger if exists audit_company_indicator_blocks on public.company_indicator_blocks;
create trigger audit_company_indicator_blocks after update on public.company_indicator_blocks
  for each row execute function public.audit_config_change();

-- alterar um indicador grava na empresa de quem altera
create or replace function public.update_indicator(p_key text, p_enabled boolean default null,
                                                   p_alert_enabled boolean default null, p_params jsonb default null)
returns public.indicators language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_ind     record;
  v_params  jsonb;
  v_field   jsonb;
  v_val     jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;

  select * into v_ind from public.my_indicators where key = p_key;
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

  insert into public.company_indicators as c (company_id, key, enabled, alert_enabled, params, updated_by, updated_at)
  values (v_company, p_key, coalesce(p_enabled, v_ind.enabled),
          case when v_ind.supports_alert then coalesce(p_alert_enabled, v_ind.alert_enabled) else false end,
          v_params, auth.uid(), now())
  on conflict (company_id, key) do update set
    enabled = excluded.enabled, alert_enabled = excluded.alert_enabled, params = excluded.params,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  -- devolve no formato de sempre (linha do catálogo), com os valores da empresa
  select * into v_ind from public.my_indicators where key = p_key;
  return jsonb_populate_record(null::public.indicators, to_jsonb(v_ind));
end;
$$;

create or replace function public.reset_indicators(p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;
  insert into public.company_indicators as c (company_id, key, enabled, alert_enabled, params, updated_by, updated_at)
  select v_company, i.key, i.default_enabled, i.default_alert_enabled, i.default_params, auth.uid(), now()
  from public.indicators i
  where p_key is null or i.key = p_key
  on conflict (company_id, key) do update set
    enabled = excluded.enabled, alert_enabled = excluded.alert_enabled, params = excluded.params,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if p_key is null then
    update public.company_indicator_blocks set enabled = true, updated_by = auth.uid(), updated_at = now()
    where company_id = v_company and not enabled;
  end if;
end;
$$;

create or replace function public.set_indicator_block_enabled(p_block text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar indicadores' using errcode = '42501';
  end if;
  if not exists (select 1 from public.indicator_blocks where key = p_block) then
    raise exception 'Bloco % não encontrado', p_block;
  end if;
  insert into public.company_indicator_blocks (company_id, key, enabled, updated_by, updated_at)
  values (public.current_company_id(), p_block, p_enabled, auth.uid(), now())
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

-- ------------------------------------------------ acesso e permissões
-- usuário ativo: perfil ativo e empresa ativa (quem administra a plataforma entra mesmo em empresa suspensa)
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p left join public.companies c on c.id = p.company_id
    where p.id = auth.uid() and p.active and (p.platform_admin or coalesce(c.active, false))
  )
$$;

-- administrador da empresa atual (quem administra a plataforma é administrador em qualquer empresa em que entrar)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles where id = auth.uid() and (role = 'admin' or platform_admin)
  )
$$;

-- grupos que o usuário vê: administrador, todos da empresa; demais, os dos seus setores
create or replace function public.visible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active_user() then '{}'::uuid[]
    when public.is_admin() then
      coalesce((select array_agg(g.id) from public.groups g where g.company_id = public.current_company_id()), '{}')
    else coalesce((
      select array_agg(g.id)
      from public.groups g
      join public.sector_members sm on sm.sector_id = g.sector_id and sm.user_id = auth.uid()
      where g.company_id = public.current_company_id()), '{}')
  end
$$;

create or replace function public.can_view_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_group_id = any(public.visible_group_ids())
$$;

create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = p_group_id and company_id = public.current_company_id())
     and public.is_active_user()
     and (public.is_admin() or exists (
       select 1
       from public.groups g
       join public.sectors s on s.id = g.sector_id
       join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
       where g.id = p_group_id
         and case p_permission
               when 'view' then true
               when 'reply' then s.can_reply
               when 'demands' then s.can_manage_demands
               when 'alerts' then s.can_handle_alerts
               else false
             end
     ))
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', public.is_admin(),
    'platform_admin', public.is_platform_admin(),
    'company_id', public.current_company_id(),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'can_reply', s.can_reply,
                                          'can_manage_demands', s.can_manage_demands,
                                          'can_handle_alerts', s.can_handle_alerts) order by s.name)
      from public.sectors s join public.sector_members sm on sm.sector_id = s.id
      where sm.user_id = auth.uid() and s.company_id = public.current_company_id()), '[]'::jsonb),
    'reply_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
      where s.can_reply and g.company_id = public.current_company_id()), '[]'::jsonb),
    'demand_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
      where s.can_manage_demands and g.company_id = public.current_company_id()), '[]'::jsonb),
    'alert_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
      where s.can_handle_alerts and g.company_id = public.current_company_id()), '[]'::jsonb)
  )
  where public.is_active_user()
$$;

-- filtros dos indicadores: horário comercial, fuso e feriados da empresa
create or replace function public.indicator_filters(p_from timestamptz, p_to timestamptz, p_group_id uuid, p_member_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'group_id', p_group_id, 'member_id', p_member_id,
    'company_id', s.company_id,
    'tz', s.timezone,
    'business_days', to_jsonb(s.business_days),
    'business_start', s.business_start, 'business_end', s.business_end,
    'holidays', coalesce((select jsonb_agg(day) from public.holidays h where h.company_id = s.company_id), '[]'::jsonb)
  )
  from public.app_settings s where s.company_id = public.ctx_company_id()
$$;

-- reincidência: o worker calcula empresa por empresa
drop function if exists public.recurrence_alert_candidates(integer, integer);
create or replace function public.recurrence_alert_candidates(p_window_minutes integer, p_min_failures integer,
                                                              p_company_id uuid default null)
returns table (group_id uuid, group_name text, failures integer, last_failure timestamptz, worst_seconds integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_company_id is not null then
    perform set_config('app.company_id', p_company_id::text, true);
  end if;
  return query
  select x.group_id, x.group_name, count(*)::int, max(x.asked_at), max(x.delay_seconds)
  from public.ind_response_failures(
    public.indicator_filters(now() - make_interval(mins => greatest(p_window_minutes, 60)), now(), null, null)
  ) x
  group by x.group_id, x.group_name
  having count(*) >= greatest(p_min_failures, 1);
end;
$$;
grant execute on function public.recurrence_alert_candidates(integer, integer, uuid) to service_role;

-- novos usuários: a empresa vem do convite (allowed_emails); o primeiro usuário do sistema administra a plataforma
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allowed public.allowed_emails%rowtype;
  v_first   boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  select * into v_allowed from public.allowed_emails where email = lower(new.email);

  insert into public.profiles (id, email, full_name, avatar_url, role, active, company_id, platform_admin)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    case when v_first then 'admin' else coalesce(v_allowed.role, 'agent') end,
    v_first or v_allowed.email is not null,
    coalesce(v_allowed.company_id, case when v_first then public.default_company_id() end),
    v_first
  );
  return new;
end;
$$;

create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
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

  insert into public.profiles (id, email, full_name, avatar_url, role, active, company_id, platform_admin)
  values (
    v_user.id,
    lower(v_user.email),
    coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'),
    v_user.raw_user_meta_data->>'avatar_url',
    case when v_first then 'admin' else coalesce(v_allowed.role, 'agent') end,
    v_first or v_allowed.email is not null,
    coalesce(v_allowed.company_id, case when v_first then public.default_company_id() end),
    v_first
  )
  -- várias requisições simultâneas podem chegar aqui ao mesmo tempo
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = auth.uid();
  return v_profile;
end;
$$;

-- convite liberado: ativa o usuário na empresa do convite (nunca muda de empresa quem já é de outra)
create or replace function public.handle_allowed_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set active = true, role = new.role, company_id = coalesce(company_id, new.company_id)
  where email = new.email and (company_id is null or company_id = new.company_id);
  return new;
end;
$$;

-- grupos novos entram no setor padrão da empresa
create or replace function public.groups_default_sector()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sector_id is null then
    select default_sector_id into new.sector_id from public.app_settings where company_id = new.company_id;
  end if;
  return new;
end;
$$;
-- o setor padrão precisa saber a empresa: roda depois do preenchimento (ordem alfabética)
drop trigger if exists groups_default_sector on public.groups;
drop trigger if exists groups_z_default_sector on public.groups;
create trigger groups_z_default_sector before insert on public.groups
  for each row execute function public.groups_default_sector();

-- marcar remetente como equipe: só na empresa do grupo da mensagem
create or replace function public.mark_sender_as_team(p_sender_jid text, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_company uuid := public.current_company_id();
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  select id into v_id from public.team_members where company_id = v_company and jid = p_sender_jid;
  if v_id is null then
    insert into public.team_members (company_id, name, jid, phone)
    values (v_company, p_name, p_sender_jid, nullif(p_phone, ''))
    returning id into v_id;
  else
    update public.team_members set name = p_name, active = true where id = v_id;
  end if;

  update public.messages m set from_team = true, team_member_id = v_id
   from public.groups g
   where g.id = m.group_id and g.company_id = v_company
     and m.sender_jid = p_sender_jid and not m.from_team;
  return v_id;
end;
$$;

create or replace function public.delete_removed_groups(p_group_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem excluir grupos';
  end if;
  delete from public.groups
  where id = any(p_group_ids) and removed_at is not null and company_id = public.current_company_id();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- --------------------------------------------- limites da empresa
-- grupos monitorados: além do limite, o grupo novo entra sem monitorar e ligar avisa
create or replace function public.enforce_group_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_n   int;
begin
  if not new.monitored or (tg_op = 'UPDATE' and old.monitored) then
    return new;
  end if;
  select max_groups into v_max from public.companies where id = new.company_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_n from public.groups
  where company_id = new.company_id and monitored and removed_at is null and id <> new.id;
  if v_n >= v_max then
    if tg_op = 'INSERT' then
      new.monitored := false;
    else
      raise exception 'Limite do plano: até % grupos monitorados. Fale com o suporte para ampliar.', v_max;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists groups_zz_limit on public.groups;
create trigger groups_zz_limit before insert or update of monitored on public.groups
  for each row execute function public.enforce_group_limit();

-- usuários: ativos + convites pendentes não passam do limite
create or replace function public.enforce_user_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_n   int;
begin
  select max_users into v_max from public.companies where id = new.company_id;
  if v_max is null or exists (select 1 from public.profiles where email = new.email and active) then
    return new;
  end if;
  select (select count(*) from public.profiles where company_id = new.company_id and active and not platform_admin)
       + (select count(*) from public.allowed_emails a where a.company_id = new.company_id and a.email <> new.email
            and not exists (select 1 from public.profiles p where p.email = a.email))
  into v_n;
  if v_n >= v_max then
    raise exception 'Limite do plano: até % usuários. Fale com o suporte para ampliar.', v_max;
  end if;
  return new;
end;
$$;
drop trigger if exists allowed_emails_limit on public.allowed_emails;
create trigger allowed_emails_limit before insert on public.allowed_emails
  for each row execute function public.enforce_user_limit();

-- ------------------------------------------ administração da plataforma
-- cadastra a empresa com tudo pronto para usar: configurações, setor "Geral" e regras de alerta padrão
create or replace function public.create_company(p_name text, p_document text default null,
  p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null,
  p_max_groups int default null, p_max_users int default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_base   uuid := (select id from public.companies order by created_at, id limit 1);
  v_sector uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma pode cadastrar empresas' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Informe o nome da empresa';
  end if;

  insert into public.companies (name, document, contact_name, contact_email, contact_phone, max_groups, max_users, notes)
  values (btrim(p_name), nullif(btrim(p_document), ''), nullif(btrim(p_contact_name), ''),
          nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_contact_phone), ''), p_max_groups, p_max_users,
          nullif(btrim(p_notes), ''))
  returning id into v_id;

  insert into public.sectors (company_id, name, description)
  values (v_id, 'Geral', 'Setor padrão: recebe os grupos novos')
  returning id into v_sector;

  -- configurações com os padrões do sistema
  insert into public.app_settings (company_id, company_name, default_sector_id)
  values (v_id, btrim(p_name), v_sector);

  -- regras de alerta padrão, sem destinatários (cada empresa configura os seus)
  insert into public.alert_rules (company_id, name, type, severity, active, threshold_minutes, threshold_count, keywords,
                                  group_ids, business_hours_only, cooldown_minutes, notify_in_app, notify_emails,
                                  notify_whatsapp, notify_webhook_url, indicator_key)
  select v_id, name, type, severity, active, threshold_minutes, threshold_count, keywords,
         null, business_hours_only, cooldown_minutes, notify_in_app, '{}', '{}', null, indicator_key
  from public.alert_rules where company_id = v_base and v_base is not null;

  -- feriados nacionais já cadastrados servem de ponto de partida
  insert into public.holidays (company_id, day, name)
  select v_id, day, name from public.holidays where company_id = v_base and v_base is not null
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.update_company(p_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma pode alterar empresas' using errcode = '42501';
  end if;
  update public.companies set
    name          = coalesce(nullif(btrim(p_changes->>'name'), ''), name),
    document      = case when p_changes ? 'document' then nullif(btrim(p_changes->>'document'), '') else document end,
    contact_name  = case when p_changes ? 'contact_name' then nullif(btrim(p_changes->>'contact_name'), '') else contact_name end,
    contact_email = case when p_changes ? 'contact_email' then nullif(lower(btrim(p_changes->>'contact_email')), '') else contact_email end,
    contact_phone = case when p_changes ? 'contact_phone' then nullif(btrim(p_changes->>'contact_phone'), '') else contact_phone end,
    max_groups    = case when p_changes ? 'max_groups' then nullif(p_changes->>'max_groups', '')::int else max_groups end,
    max_users     = case when p_changes ? 'max_users' then nullif(p_changes->>'max_users', '')::int else max_users end,
    notes         = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'), '') else notes end,
    active        = coalesce((p_changes->>'active')::boolean, active),
    updated_at    = now()
  where id = p_id;
  if not found then
    raise exception 'Empresa não encontrada';
  end if;
  -- empresa suspensa: o worker encerra as conexões dela (sem apagar a sessão) e não reconecta enquanto estiver suspensa
end;
$$;

-- empresas com números para a tela de administração
create or replace function public.platform_companies()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'document', c.document, 'contact_name', c.contact_name,
    'contact_email', c.contact_email, 'contact_phone', c.contact_phone, 'active', c.active,
    'max_groups', c.max_groups, 'max_users', c.max_users, 'notes', c.notes, 'created_at', c.created_at,
    'users', (select count(*) from public.profiles p where p.company_id = c.id and p.active and not p.platform_admin),
    'pending_invites', (select count(*) from public.allowed_emails a where a.company_id = c.id
                          and not exists (select 1 from public.profiles p where p.email = a.email)),
    'admins', coalesce((select jsonb_agg(p.email order by p.email) from public.profiles p
                         where p.company_id = c.id and p.role = 'admin' and p.active and not p.platform_admin), '[]'::jsonb),
    'groups_monitored', (select count(*) from public.groups g where g.company_id = c.id and g.monitored and g.removed_at is null),
    'connections', (select count(*) from public.whatsapp_instances w where w.company_id = c.id),
    'connected', (select count(*) from public.whatsapp_instances w where w.company_id = c.id and w.status = 'connected'),
    'messages_30d', (select count(*) from public.messages m join public.groups g on g.id = m.group_id
                      where g.company_id = c.id and m.sent_at > now() - interval '30 days'),
    'last_message_at', (select max(g.last_message_at) from public.groups g where g.company_id = c.id)
  ) order by c.name), '[]'::jsonb)
  from public.companies c
  where public.is_platform_admin()
$$;

-- quem administra a plataforma entra em uma empresa para configurar ou dar suporte
create or replace function public.switch_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma pode trocar de empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Empresa não encontrada';
  end if;
  update public.profiles set company_id = p_company_id where id = auth.uid();
end;
$$;

grant execute on function public.create_company(text, text, text, text, text, int, int, text),
  public.update_company(uuid, jsonb), public.platform_companies(), public.switch_company(uuid),
  public.current_company_id(), public.ctx_company_id(), public.is_platform_admin(),
  public.company_indicator_params(uuid, text)
  to authenticated;

-- ------------------------------------------------------ regras (RLS)
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['alert_rules', 'alerts', 'allowed_emails', 'app_settings', 'config_audit', 'demand_events',
                           'demands', 'groups', 'holidays', 'messages', 'outgoing_messages', 'profiles', 'sector_members',
                           'sectors', 'team_members', 'whatsapp_instances', 'companies', 'company_indicators',
                           'company_indicator_blocks'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- empresa: cada usuário lê a sua; quem administra a plataforma lê todas (escrita só pelas funções acima)
create policy companies_read on public.companies for select
  using (id = (select public.current_company_id()) or (select public.is_platform_admin()));

create policy profiles_select on public.profiles for select
  using (id = auth.uid() or ((select public.is_active_user()) and company_id = (select public.current_company_id())));
-- o administrador da empresa não altera quem administra a plataforma (que pode estar na empresa dando suporte)
create policy profiles_admin_update on public.profiles for update
  using ((select public.is_admin()) and company_id = (select public.current_company_id())
         and (not platform_admin or (select public.is_platform_admin())))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));
create policy profiles_admin_delete on public.profiles for delete
  using ((select public.is_admin()) and company_id = (select public.current_company_id()) and id <> auth.uid()
         and (not platform_admin or (select public.is_platform_admin())));

-- ninguém se promove a administrador da plataforma nem muda alguém de empresa pelo painel
-- (só as funções da plataforma, ou o próprio banco)
create or replace function public.guard_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.acting_user() and not public.is_platform_admin()
     and (new.platform_admin is distinct from old.platform_admin
          or (old.company_id is not null and new.company_id is distinct from old.company_id)) then
    raise exception 'Alteração não permitida' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_change();

create policy allowed_emails_admin on public.allowed_emails for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

create policy settings_read on public.app_settings for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy settings_write on public.app_settings for update
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

create policy config_audit_admin on public.config_audit for select
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));

create policy rules_read on public.alert_rules for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy rules_write on public.alert_rules for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

create policy holidays_read on public.holidays for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy holidays_admin on public.holidays for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

create policy company_indicators_read on public.company_indicators for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy company_indicator_blocks_read on public.company_indicator_blocks for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));

create policy sectors_read on public.sectors for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy sectors_write on public.sectors for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));
create policy sector_members_read on public.sector_members for select
  using (user_id = auth.uid()
         or ((select public.is_admin()) and sector_id in (select id from public.sectors)));
create policy sector_members_write on public.sector_members for all
  using ((select public.is_admin()) and sector_id in (select id from public.sectors))
  with check ((select public.is_admin()) and sector_id in (select id from public.sectors)
              and user_id in (select id from public.profiles where company_id = (select public.current_company_id())));

create policy team_read on public.team_members for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy team_write on public.team_members for all
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()))
  with check ((select public.is_active_user()) and company_id = (select public.current_company_id()));

create policy instances_read on public.whatsapp_instances for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
create policy instances_write on public.whatsapp_instances for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

-- dados dos grupos: só os grupos visíveis (que já são só os da empresa)
create policy groups_read on public.groups for select
  using (id in (select unnest(public.visible_group_ids())));
create policy groups_update on public.groups for update
  using (id in (select unnest(public.visible_group_ids())))
  with check (id in (select unnest(public.visible_group_ids())));
create policy messages_read on public.messages for select
  using (group_id in (select unnest(public.visible_group_ids())));
create policy outgoing_read on public.outgoing_messages for select
  using (group_id in (select unnest(public.visible_group_ids())));
create policy demands_read on public.demands for select
  using (group_id in (select unnest(public.visible_group_ids())));
create policy demand_events_read on public.demand_events for select
  using (demand_id in (select d.id from public.demands d));
-- alertas sem grupo (ex.: WhatsApp desconectado) são de todos os usuários da empresa
create policy alerts_read on public.alerts for select
  using (group_id in (select unnest(public.visible_group_ids()))
         or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id())));
create policy alerts_update on public.alerts for update
  using (group_id in (select unnest(public.visible_group_ids()))
         or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id())))
  with check (group_id in (select unnest(public.visible_group_ids()))
         or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id())));

-- ------------------------- funções ajustadas para a empresa (geradas)
-- (configurações e indicadores lidos da empresa do contexto)
create or replace function public.groups_panel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_f      jsonb;
  v_today  timestamptz;
  v_useful boolean := public.sla_business_time_only();
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select date_trunc('day', now() at time zone s.timezone) at time zone s.timezone into v_today
  from public.app_settings s where s.company_id = public.current_company_id();
  v_f := public.indicator_filters(v_today, now(), null, null);

  return coalesce((
    with g as (
      select g.id, g.name, g.participants_count, g.pending_since, g.pending_count, g.last_message_at,
             g.last_client_message_at, g.last_team_message_at,
             coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s
      from public.groups g join public.app_settings s on s.company_id = g.company_id
      where g.monitored and g.removed_at is null
    ),
    d as (
      select g.*,
             (select count(*) from public.messages m
               where m.group_id = g.id and not m.from_team and m.sent_at >= v_today)::int as received_today,
             (select count(*) from public.messages m
               where m.group_id = g.id and m.from_team and m.sent_at >= v_today)::int as team_today,
             (select count(*) from public.messages m
               where m.group_id = g.id and m.from_team and m.response_time_seconds is not null and m.sent_at >= v_today)::int as answers_today,
             case when g.pending_since is not null then extract(epoch from now() - g.pending_since)::int end as waiting_s,
             case when g.pending_since is not null then
               case when v_useful then public.business_seconds(g.pending_since, now(), v_f)
                    else extract(epoch from now() - g.pending_since)::int end end as waiting_counted_s
      from g
    ),
    st as (
      select d.*,
             case when d.pending_since is not null and d.waiting_counted_s > d.sla_s then 'late'
                  when d.pending_since is not null then 'waiting'
                  when d.received_today > 0 then 'answered'
                  else 'neutral' end as status
      from d
    )
    select jsonb_agg(jsonb_build_object(
      'id', st.id, 'name', st.name, 'participants', st.participants_count, 'status', st.status,
      'received_today', st.received_today, 'answers_today', st.answers_today, 'team_today', st.team_today,
      'pending_count', st.pending_count, 'pending_since', st.pending_since,
      'waiting_seconds', st.waiting_s, 'waiting_counted_seconds', st.waiting_counted_s,
      'sla_seconds', st.sla_s, 'business_time', v_useful,
      'last_message_at', st.last_message_at, 'last_client_at', st.last_client_message_at, 'last_team_at', st.last_team_message_at,
      -- últimas mensagens recebidas dos clientes (as de hoje, ou a última, se não houver hoje)
      'messages', coalesce((
        select jsonb_agg(x order by x->>'at') from (
          select jsonb_build_object(
                   'who', coalesce(m.sender_name, m.sender_phone, 'Cliente'),
                   'body', left(m.body, 160), 'type', m.message_type, 'at', m.sent_at,
                   -- sem resposta: depois da última mensagem da equipe
                   'pending', st.pending_since is not null and m.sent_at >= st.pending_since
                 ) as x
          from public.messages m
          where m.group_id = st.id and not m.from_team
          order by m.sent_at desc
          limit 3
        ) y
      ), '[]'::jsonb),
      -- última resposta da equipe
      'last_reply', (
        select jsonb_build_object('who', coalesce(tm.name, m.sender_name, case when m.from_me then 'Número conectado' end, 'Equipe'),
                                  'at', m.sent_at, 'response_seconds', m.response_time_seconds)
        from public.messages m left join public.team_members tm on tm.id = m.team_member_id
        where m.group_id = st.id and m.from_team
        order by m.sent_at desc limit 1
      )
    ) order by case st.status when 'late' then 0 when 'waiting' then 1 when 'answered' then 2 else 3 end,
               st.pending_since nulls last, st.last_message_at desc nulls last)
    from st
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.sla_breaches()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_f      jsonb;
  v_useful boolean := public.sla_business_time_only();
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  v_f := public.indicator_filters(now(), now(), null, null);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'group_id', x.id, 'group', x.name, 'pending_since', x.pending_since, 'pending_count', x.pending_count,
      'waiting_seconds', x.waited, 'sla_seconds', x.sla_s,
      'who', coalesce(pm.sender_name, pm.sender_phone, 'Cliente'), 'phone', pm.sender_phone,
      'body', left(pm.body, 300), 'type', pm.message_type
    ) order by x.pending_since)
    from (
      select g.id, g.name, g.pending_since, g.pending_count, g.pending_message_id,
             coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s,
             extract(epoch from now() - g.pending_since)::int as waited,
             case when v_useful then public.business_seconds(g.pending_since, now(), v_f)
                  else extract(epoch from now() - g.pending_since)::int end as counted
      from public.groups g join public.app_settings s on s.company_id = g.company_id
      where g.monitored and g.removed_at is null and g.pending_since is not null
    ) x
    left join public.messages pm on pm.id = x.pending_message_id
    where x.counted > x.sla_s
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.group_stats(p_group_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_sla    int;
  v_result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select coalesce(g.sla_minutes, s.default_sla_minutes) * 60 into v_sla
  from public.groups g join public.app_settings s on s.company_id = g.company_id
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
$function$;

create or replace function public.ind_pending_messages(f jsonb, p jsonb)
 RETURNS TABLE(message_id uuid, group_id uuid, group_name text, client_name text, body text, message_type text, sent_at timestamp with time zone, waiting_seconds integer, waiting_business_seconds integer, sla_seconds integer, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with g as (
    select g.*, coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s
    from public.groups g join public.app_settings s on s.company_id = g.company_id
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
$function$;

create or replace function public.ind_reply_analysis(f jsonb, p jsonb)
 RETURNS TABLE(group_id uuid, group_name text, verdict text, priority text, reason text, quote text, client_name text, msgs integer, clients integer, first_at timestamp with time zone, last_at timestamp with time zone, waiting_seconds integer, overdue boolean, signals text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with g as (
    select g.id, g.name, coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s,
           (select max(t.sent_at) from public.messages t where t.group_id = g.id and t.from_team) as last_team_at
    from public.groups g join public.app_settings s on s.company_id = g.company_id
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
$function$;

create or replace function public.ind_scope(f jsonb)
 RETURNS TABLE(id uuid, group_id uuid, group_name text, sender_name text, sender_phone text, from_me boolean, from_team boolean, team_member_id uuid, message_type text, body text, sent_at timestamp with time zone, response_time_seconds integer, answered_message_id uuid, sla_seconds integer, opens_pending boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select m.id, m.group_id, g.name, m.sender_name, m.sender_phone, m.from_me, m.from_team, m.team_member_id,
         m.message_type, m.body, m.sent_at, m.response_time_seconds, m.answered_message_id,
         coalesce(g.sla_minutes, s.default_sla_minutes) * 60, m.opens_pending
  from public.messages m
  join public.groups g on g.id = m.group_id
  join public.app_settings s on s.company_id = g.company_id
  where g.monitored
    and m.sent_at >= (f->>'from')::timestamptz
    and m.sent_at < (f->>'to')::timestamptz
    and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    and ((f->>'company_id') is null or g.company_id = (f->>'company_id')::uuid)
$function$;

create or replace function public.dashboard_metrics(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_tz      text;
  v_sla     int;
  v_result  jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select timezone, default_sla_minutes into v_tz, v_sla from public.app_settings where company_id = public.current_company_id();

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
$function$;

create or replace function public.ind_tempo_resposta_hora(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                     || ' · SLA ' || coalesce((select default_sla_minutes from public.app_settings where company_id = (f->>'company_id')::uuid), 30) || ' min',
                     'Nenhuma resposta no período'),
    'series', jsonb_build_array(
      jsonb_build_object('key', 'avg_s', 'label', 'Tempo médio'),
      jsonb_build_object('key', 'max_s', 'label', 'Pior tempo')
    ),
    'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'label', x, 'avg_s', avg_s, 'max_s', max_s) order by t0) from v), '[]'::jsonb)
  )
$function$;

create or replace function public.can_reply()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_active_user()
     and s.reply_enabled
     and (s.reply_allowed = 'all' or public.is_admin())
  from public.app_settings s where s.company_id = public.current_company_id()
$function$;

create or replace function public.create_demand(p_group_id uuid, p_description text, p_message_id uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_assignee_id uuid DEFAULT NULL::uuid, p_promised_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'manual'::text, p_actor text DEFAULT NULL::text)
 RETURNS demands
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_d      public.demands%rowtype;
  v_opened timestamptz;
  v_set    public.app_settings%rowtype;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.app_settings
   where company_id = (select company_id from public.groups where id = p_group_id);
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
$function$;

create or replace function public.send_group_message(p_group_id uuid, p_body text, p_quoted_message_id uuid DEFAULT NULL::uuid)
 RETURNS outgoing_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select * into v_settings from public.app_settings
   where company_id = (select company_id from public.groups where id = p_group_id);
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
$function$;

create or replace function public.ind_conversations(f jsonb, p jsonb)
 RETURNS TABLE(group_id uuid, group_name text, started_at timestamp with time zone, started_by text, starter text, start_body text, first_team_at timestamp with time zone, status text, closed_at timestamp with time zone, closed_by text, closer text, close_body text, last_at timestamp with time zone, msgs integer, returned_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  -- palavras de pergunta/pedido/urgência/encerramento do cliente vêm da análise "Precisa de resposta?"
  v_sig_p jsonb := coalesce((select i.params from public.my_indicators i where i.key = 'analise_sem_resposta'), '{}'::jsonb)
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
$function$;

create or replace function public.ind_conversas_por_dia(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with c as (
    select * from public.ind_conversations(f,
      coalesce((select i.params from public.my_indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb))
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
$function$;

create or replace function public.ind_conversas_por_dia_details(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select public.ind_conversas_details(f, coalesce((select i.params from public.my_indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb)) $function$;

create or replace function public.management_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  f      jsonb;
  v_kpi  jsonb := '{}'::jsonb;
  v_key  text;
  v_data jsonb;
  v_panel jsonb;
  v_flow  jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  -- indicadores reaproveitados (valor e tom), mesmo desligados no dashboard
  foreach v_key in array array['tempo_primeira_resposta', 'taxa_resposta_sla', 'prazo_prometido_cumprido',
                               'conversas_ciclo', 'grupos_silenciosos', 'tempo_resolucao'] loop
    begin
      execute format('select public.%I($1, $2)', 'ind_' || v_key)
        into v_data using f, (select params from public.my_indicators where key = v_key);
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object(
        'value', v_data->'value', 'tone', v_data->'tone', 'hint', v_data->'hint', 'secondary', v_data->'secondary',
        'trend', v_data->'trend'->'data'));
    exception when others then
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object('value', null));
    end;
  end loop;

  -- fluxo de mensagens (por hora num dia, por dia em vários): recebidas x respostas
  begin
    v_flow := public.ind_dia_hora_a_hora(f, (select params from public.my_indicators where key = 'dia_hora_a_hora'));
  exception when others then
    v_flow := null;
  end;

  -- situação dos grupos agora (mesma regra do painel de grupos)
  v_panel := coalesce((
    select jsonb_agg(g) from jsonb_array_elements(public.groups_panel()) g
    where p_group_id is null or (g->>'id')::uuid = p_group_id
  ), '[]'::jsonb);

  return jsonb_build_object(
    -- atendimento no período
    'client_messages', (select count(*) from public.ind_scope(f) m where not m.from_team),
    'team_replies', (select count(*) from public.ind_scope(f) m
                      where m.from_team and (p_member_id is null or m.team_member_id = p_member_id)),
    'first_response', v_kpi->'tempo_primeira_resposta',
    'sla_rate', v_kpi->'taxa_resposta_sla',
    'sla_target', (select (params->>'target_percent')::numeric from public.my_indicators where key = 'taxa_resposta_sla'),
    -- situação agora
    'groups_waiting', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' in ('waiting', 'late')),
    'groups_late', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' = 'late'),
    'pending_messages', (select coalesce(sum((g->>'pending_count')::int), 0) from jsonb_array_elements(v_panel) g),
    'alerts_open', (select count(*) from public.alerts a
                     where a.status <> 'resolved' and (p_group_id is null or a.group_id = p_group_id)),
    'alerts_critical', (select count(*) from public.alerts a
                         where a.status <> 'resolved' and a.severity = 'critical'
                           and (p_group_id is null or a.group_id = p_group_id)),
    'whatsapp', (select case when bool_or(status = 'connected') then 'connected'
                             when count(*) = 0 then 'none' else 'disconnected' end
                 from public.whatsapp_instances),
    -- demandas
    'demands_open', (select count(*) from public.demands d
                      where d.status in ('aberta', 'em_andamento')
                        and (p_group_id is null or d.group_id = p_group_id)
                        and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_overdue', (select count(*) from public.demands d
                         where d.status in ('aberta', 'em_andamento') and d.promised_at < now()
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_created', (select count(*) from public.demands d
                         where d.opened_at >= p_from and d.opened_at < p_to
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_delivered', (select count(*) from public.demands d
                           where d.delivered_at >= p_from and d.delivered_at < p_to
                             and (p_group_id is null or d.group_id = p_group_id)
                             and (p_member_id is null or d.assignee_id = p_member_id)),
    'promise_kept', v_kpi->'prazo_prometido_cumprido',
    'resolution_time', v_kpi->'tempo_resolucao',
    -- conversas e grupos
    'conversations', v_kpi->'conversas_ciclo',
    -- fechadas = encerradas + compromisso de retorno (mesma regra do indicador)
    'conversations_closed_rate', (
      select case when coalesce((v_kpi->'conversas_ciclo'->>'value')::numeric, 0) = 0 then null
                  else round(100.0 * coalesce(sum((x->>'value')::numeric), 0)
                             / (v_kpi->'conversas_ciclo'->>'value')::numeric, 1) end
      from jsonb_array_elements(coalesce(v_kpi->'conversas_ciclo'->'secondary', '[]'::jsonb)) x
      where x->>'label' in ('Encerradas', 'Compromisso de retorno')),
    'groups_active', (select count(distinct m.group_id) from public.ind_scope(f) m),
    'groups_monitored', (select count(*) from public.groups g
                          where g.monitored and g.removed_at is null and (p_group_id is null or g.id = p_group_id)),
    'groups_silent', v_kpi->'grupos_silenciosos',
    'flow', coalesce(v_flow->'data', '[]'::jsonb),
    'flow_hourly', coalesce(v_flow->>'visual' = 'bars', false)
  );
end;
$function$;

create or replace function public.sla_business_time_only()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select (params->>'business_time_only')::boolean from public.my_indicators where key = 'taxa_resposta_sla'), true)
$function$;

create or replace function public.indicator_values(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    from public.my_indicators i join public.my_indicator_blocks b on b.key = i.block_key
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
$function$;

create or replace function public.indicator_details(p_key text, p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_ind  record;
  v_data jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select i.* into v_ind from public.my_indicators i join public.my_indicator_blocks b on b.key = i.block_key
  where i.key = p_key and i.enabled and b.enabled and i.has_details;
  if not found then
    raise exception 'Indicador indisponível';
  end if;
  execute format('select public.%I($1, $2)', 'ind_' || v_ind.key || '_details')
    into v_data using public.indicator_filters(p_from, p_to, p_group_id, p_member_id), v_ind.params;
  return v_data;
end;
$function$;

-- as funções que usam a empresa do contexto continuam respeitando as regras de quem chama
alter function public.groups_panel() security invoker;
alter function public.sla_breaches() security invoker;

-- realtime: a tela de empresas atualiza sozinha
do $$ begin
  begin alter publication supabase_realtime add table public.companies; exception when others then null; end;
  begin alter publication supabase_realtime add table public.company_indicators; exception when others then null; end;
  begin alter publication supabase_realtime add table public.company_indicator_blocks; exception when others then null; end;
end $$;

notify pgrst, 'reload schema';
