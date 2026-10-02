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
