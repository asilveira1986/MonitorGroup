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
