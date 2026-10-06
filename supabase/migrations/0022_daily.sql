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
