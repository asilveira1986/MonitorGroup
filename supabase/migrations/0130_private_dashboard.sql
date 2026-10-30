-- =====================================================================
-- Dashboard das conversas privadas (filtro "Grupos | Privado").
--
-- private_dashboard(de, até, usuário, só números) devolve os indicadores
-- no mesmo formato do dashboard dos grupos (cartões, gráfico e tabela),
-- calculados com as permissões de quem pede: cada um vê os números das
-- conversas que vê (a fila e as suas; administradores e o setor padrão,
-- todas).
--
--  * Tempo de resposta: da primeira mensagem do cliente que ficou sem
--    resposta até a primeira resposta da empresa (tempo corrido).
--  * Quem respondeu: quem enviou pelo sistema; enviado pelo celular, o
--    responsável pela conversa.
--  * Filtro de usuário: as conversas que estão ou estiveram com ele e as
--    respostas dele.
-- =====================================================================

-- nome de um usuário da mesma empresa (para as listas e tabelas do dashboard)
create or replace function public.company_user_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.user_display_name(p_user)
   where exists (select 1 from public.profiles p where p.id = p_user and p.company_id = public.current_company_id())
$$;
revoke all on function public.company_user_name(uuid) from public, anon;
grant execute on function public.company_user_name(uuid) to authenticated;

create or replace function public.private_dashboard(
  p_from timestamptz, p_to timestamptz, p_user uuid default null, p_kpi_only boolean default false
)
returns jsonb language sql stable set search_path = public as $$
  with
  cfg as (
    select coalesce((select timezone from public.app_settings where company_id = public.current_company_id()), 'America/Sao_Paulo') as tz
  ),
  -- conversas que quem pede vê (RLS), com o filtro de usuário
  ch as materialized (
    select c.id, coalesce(nullif(btrim(c.name), ''), c.phone, 'Contato') as name, c.assigned_to, c.closed_at, c.closed_by,
           c.last_message_at
      from public.private_chats c
     where public.can_use_private_chats()
       and c.company_id = public.current_company_id()
       and (p_user is null or c.assigned_to = p_user or c.closed_by = p_user
            or exists (select 1 from public.private_outgoing o
                        where o.chat_id = c.id and o.created_by = p_user and o.created_at >= p_from and o.created_at < p_to))
  ),
  -- mensagens do período, com a anterior da mesma conversa
  msg as materialized (
    select m.id, m.chat_id, m.from_me, m.sent_at, m.wa_message_id,
           coalesce(lag(m.from_me) over (partition by m.chat_id order by m.sent_at),
                    (select p.from_me from public.private_messages p
                      where p.chat_id = m.chat_id and p.sent_at < p_from order by p.sent_at desc limit 1)) as prev_me
      from public.private_messages m
      join ch on ch.id = m.chat_id
     where m.sent_at >= p_from and m.sent_at < p_to
  ),
  -- quem enviou cada mensagem da empresa: pelo sistema, quem enviou; pelo celular, o responsável
  sent as materialized (
    select m.chat_id, m.sent_at,
           coalesce((select o.created_by from public.private_outgoing o
                      where o.chat_id = m.chat_id and o.wa_message_id = m.wa_message_id limit 1),
                    (select ch.assigned_to from ch where ch.id = m.chat_id)) as user_id
      from msg m
     where m.from_me
  ),
  -- mensagens do cliente no período que ficaram sem resposta até agora
  waits as materialized (
    select w.chat_id, w.sent_at
      from msg w
     where not w.from_me and coalesce(w.prev_me, true)
       and not exists (select 1 from public.private_messages x where x.chat_id = w.chat_id and x.from_me and x.sent_at >= w.sent_at)
  ),
  -- respostas do período (mensagem da empresa logo depois de mensagem do cliente): desde quando o cliente
  -- esperava (primeira mensagem dele depois da última resposta, mesmo antes do período) e quem respondeu
  answers as materialized (
    select r.chat_id, r.sent_at, s.user_id,
           extract(epoch from r.sent_at - (
             select min(x.sent_at) from public.private_messages x
              where x.chat_id = r.chat_id and not x.from_me and x.sent_at < r.sent_at
                and x.sent_at > coalesce((select max(y.sent_at) from public.private_messages y
                                           where y.chat_id = r.chat_id and y.from_me and y.sent_at < r.sent_at), '-infinity'))
           )::int as seconds
      from msg r
      join sent s on s.chat_id = r.chat_id and s.sent_at = r.sent_at
     where r.from_me and r.prev_me = false
       and (p_user is null or s.user_id = p_user)
  ),
  -- agora: sem resposta (última mensagem é do cliente) e na fila (sem responsável)
  pending as (
    select ch.id, ch.name, ch.assigned_to, l.sent_at as since
      from ch
      join lateral (select x.from_me, x.sent_at from public.private_messages x
                     where x.chat_id = ch.id order by x.sent_at desc limit 1) l on not l.from_me
     where ch.closed_at is null
  ),
  queue as (select ch.* from ch where ch.assigned_to is null and ch.closed_at is null and ch.last_message_at is not null),
  firsts as (
    select ch.id from ch
     where (select min(x.sent_at) from public.private_messages x where x.chat_id = ch.id) >= p_from
       and (select min(x.sent_at) from public.private_messages x where x.chat_id = ch.id) < p_to
  ),
  slots as (
    select s.t0, s.t1, s.x, s.hourly
      from cfg, public.ind_slots(jsonb_build_object('from', p_from, 'to', p_to, 'tz', cfg.tz)) s
  ),
  per_slot as (
    select s.t0, s.x, s.hourly,
           count(*) filter (where not m.from_me) as received,
           count(*) filter (where m.from_me) as sent,
           count(distinct m.chat_id) as chats
      from slots s
      cross join cfg
      left join msg m on m.sent_at at time zone cfg.tz >= s.t0 and m.sent_at at time zone cfg.tz < s.t1
     group by s.t0, s.x, s.hourly
  ),
  trend as (
    select jsonb_agg(jsonb_build_object('x', x, 'chats', chats, 'received', received, 'sent', sent) order by t0) as d,
           bool_or(hourly) as hourly
      from per_slot
  ),
  tot as (
    select (select count(distinct chat_id) from msg) as chats,
           (select count(*) from msg where not from_me) as received,
           (select count(*) from msg where from_me) as sent,
           (select round(avg(seconds)) from answers) as avg_reply,
           (select percentile_cont(0.5) within group (order by seconds) from answers) as median_reply,
           (select count(*) from answers) as answered,
           (select count(*) from waits) as unanswered,
           (select count(*) from ch where closed_at >= p_from and closed_at < p_to) as finished,
           (select count(*) from firsts) as new_contacts,
           (select count(*) from pending) as pending_now,
           (select count(*) from queue) as queue_now,
           (select count(*) from ch where assigned_to is not null and closed_at is null) as in_service
  ),
  kpi as (
    select jsonb_build_array(
      jsonb_build_object('key', 'priv_conversas', 'name', 'Conversas no período', 'block_key', 'priv_volume', 'block_name', 'Conversas privadas',
        'description', 'Conversas privadas com alguma mensagem no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.chats, 'format', 'number', 'unit', 'conversas',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Novos contatos', 'value', tot.new_contacts, 'format', 'number')),
          'trend', jsonb_build_object('format', 'number', 'label', 'Conversas',
                     'data', (select jsonb_agg(jsonb_build_object('x', e->>'x', 'value', (e->>'chats')::int)) from trend, jsonb_array_elements(trend.d) e)))),
      jsonb_build_object('key', 'priv_recebidas', 'name', 'Mensagens recebidas', 'block_key', 'priv_volume', 'block_name', 'Conversas privadas',
        'description', 'Mensagens dos clientes no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.received, 'format', 'number',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Enviadas pela empresa', 'value', tot.sent, 'format', 'number')),
          'trend', jsonb_build_object('format', 'number', 'label', 'Recebidas',
                     'data', (select jsonb_agg(jsonb_build_object('x', e->>'x', 'value', (e->>'received')::int)) from trend, jsonb_array_elements(trend.d) e)))),
      jsonb_build_object('key', 'priv_tempo_resposta', 'name', 'Tempo médio de resposta', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Da mensagem do cliente até a primeira resposta da empresa (tempo corrido)', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.avg_reply, 'format', 'duration',
          'tone', case when tot.avg_reply is null then null when tot.avg_reply <= 900 then 'good' when tot.avg_reply <= 3600 then 'warning' else 'critical' end,
          'secondary', jsonb_build_array(
            jsonb_build_object('label', 'Mediana', 'value', round(tot.median_reply::numeric), 'format', 'duration'),
            jsonb_build_object('label', 'Respondidas', 'value', tot.answered, 'format', 'number')))),
      jsonb_build_object('key', 'priv_sem_resposta', 'name', 'Sem resposta agora', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas abertas em que a última mensagem é do cliente', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.pending_now, 'format', 'number', 'unit', 'conversas',
          'tone', case when tot.pending_now = 0 then 'good' when tot.pending_now <= 5 then 'warning' else 'critical' end,
          'list_size', 5, 'list_more', greatest(tot.pending_now - 20, 0),
          'list', coalesce((select jsonb_agg(jsonb_build_object('label', p.name,
                                     'sublabel', coalesce(public.company_user_name(p.assigned_to), 'Aguardando'),
                                     'detail', extract(epoch from now() - p.since)::int, 'detail_format', 'duration',
                                     'tone', case when now() - p.since > interval '1 hour' then 'critical' else null end) order by p.since)
                            from (select * from pending order by since limit 20) p), '[]'::jsonb))),
      jsonb_build_object('key', 'priv_fila', 'name', 'Aguardando atendimento', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas sem responsável agora', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.queue_now, 'format', 'number', 'unit', 'na fila',
          'tone', case when tot.queue_now = 0 then 'good' else 'warning' end,
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Em atendimento', 'value', tot.in_service, 'format', 'number')))),
      jsonb_build_object('key', 'priv_finalizadas', 'name', 'Atendimentos finalizados', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas finalizadas no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.finished, 'format', 'number',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Clientes sem resposta no período', 'value', tot.unanswered, 'format', 'number'))))
    ) as items
    from tot
  ),
  charts as (
    select case when p_kpi_only then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('key', 'priv_volume_chart', 'name', 'Mensagens no período', 'block_key', 'priv_detalhes', 'block_name', 'Detalhes',
        'description', 'Mensagens recebidas dos clientes e enviadas pela empresa', 'size', 2, 'has_details', false,
        'data', jsonb_build_object('visual', case when trend.hourly then 'bars' else 'series' end, 'format', 'number',
          'series', jsonb_build_array(jsonb_build_object('key', 'received', 'label', 'Recebidas'),
                                      jsonb_build_object('key', 'sent', 'label', 'Enviadas')),
          'data', coalesce((select jsonb_agg(jsonb_build_object('x', e->>'x', 'label', e->>'x', 'received', (e->>'received')::int,
                                                                'sent', (e->>'sent')::int)) from jsonb_array_elements(trend.d) e), '[]'::jsonb))),
      jsonb_build_object('key', 'priv_atendentes', 'name', 'Atendimento por usuário', 'block_key', 'priv_detalhes', 'block_name', 'Detalhes',
        'description', 'Conversas, respostas e tempo de resposta de cada usuário no período', 'size', 3, 'has_details', false,
        'data', jsonb_build_object('visual', 'table',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'user', 'label', 'Usuário'),
            jsonb_build_object('key', 'chats', 'label', 'Conversas', 'format', 'number', 'align', 'right', 'bar', true),
            jsonb_build_object('key', 'sent', 'label', 'Mensagens enviadas', 'format', 'number', 'align', 'right'),
            jsonb_build_object('key', 'avg_reply', 'label', 'Tempo médio de resposta', 'format', 'duration', 'align', 'right'),
            jsonb_build_object('key', 'finished', 'label', 'Finalizadas', 'format', 'number', 'align', 'right'),
            jsonb_build_object('key', 'open_now', 'label', 'Em atendimento agora', 'format', 'number', 'align', 'right')),
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object('user', public.company_user_name(u.user_id), 'chats', u.chats, 'sent', u.sent,
                                                'avg_reply', u.avg_reply, 'finished', u.finished, 'open_now', u.open_now)
                             order by u.chats desc, u.sent desc)
              from (
                select x.user_id,
                       (select count(distinct s.chat_id) from sent s where s.user_id = x.user_id) as chats,
                       (select count(*) from sent s where s.user_id = x.user_id) as sent,
                       (select round(avg(a.seconds)) from answers a where a.user_id = x.user_id) as avg_reply,
                       (select count(*) from ch where ch.closed_by = x.user_id and ch.closed_at >= p_from and ch.closed_at < p_to) as finished,
                       (select count(*) from ch where ch.assigned_to = x.user_id and ch.closed_at is null) as open_now
                  from (select user_id from sent union select assigned_to from ch where closed_at is null
                        union select closed_by from ch where closed_at >= p_from and closed_at < p_to) x
                 where x.user_id is not null and (p_user is null or x.user_id = p_user)
              ) u), '[]'::jsonb)))
    ) end as items
    from trend
  )
  select kpi.items || charts.items from kpi, charts
$$;
revoke all on function public.private_dashboard(timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.private_dashboard(timestamptz, timestamptz, uuid, boolean) to authenticated;
