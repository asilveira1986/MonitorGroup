-- =====================================================================
-- Painel de grupos: um cartão por grupo com as últimas mensagens do dia
--
-- Situação de cada grupo:
--  * neutral  (neutro):    nenhuma mensagem de cliente hoje e nada pendente;
--  * answered (verde):     teve mensagem de cliente hoje e tudo foi respondido;
--  * waiting  (amarelo):   tem mensagem sem resposta, ainda dentro do SLA;
--  * late     (vermelho):  tem mensagem sem resposta e o tempo de resposta
--                          (SLA do grupo ou o padrão) já foi excedido.
-- O SLA segue a mesma regra dos indicadores: em tempo útil (horário
-- comercial) se essa opção estiver ligada, ou em tempo corrido.
-- =====================================================================

create or replace function public.groups_panel()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_f      jsonb;
  v_today  timestamptz;
  v_useful boolean := public.sla_business_time_only();
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select date_trunc('day', now() at time zone s.timezone) at time zone s.timezone into v_today
  from public.app_settings s where s.id = 1;
  v_f := public.indicator_filters(v_today, now(), null, null);

  return coalesce((
    with g as (
      select g.id, g.name, g.participants_count, g.pending_since, g.pending_count, g.last_message_at,
             g.last_client_message_at, g.last_team_message_at,
             coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s
      from public.groups g cross join public.app_settings s
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
$$;

revoke all on function public.groups_panel() from public, anon;
grant execute on function public.groups_panel() to authenticated;

notify pgrst, 'reload schema';
