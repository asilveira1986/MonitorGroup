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
    'format', 'percent',
    'value', v.pct,
    'tone', case when v.recurrent = 0 then 'good'
                 when v.pct <= coalesce((p->>'target_percent')::numeric, 20) then 'warning'
                 else 'critical' end,
    'hint', case when v.groups = 0 then 'Nenhuma falha de resposta no período'
                 when v.recurrent = 0 then 'Nenhum grupo reincidente · ' || v.groups || ' grupo(s) com falha isolada'
                 else v.recurrent || ' de ' || v.groups || ' grupo(s) com falha são reincidentes'
                      || coalesce(' · mais reincidente: ' || (select group_name || ' (' || failures || ' falhas)' from top), '')
            end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Grupos reincidentes', 'value', v.recurrent, 'format', 'number'),
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
