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
