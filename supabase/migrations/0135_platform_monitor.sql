-- =====================================================================
-- Acompanhamento da plataforma (só quem administra a plataforma).
--
--  * profiles.last_seen_at: o painel aberto avisa a cada 2 minutos
--    (touch_last_seen); "online" = visto nos últimos 3 minutos.
--  * platform_monitor(): por empresa, usuários online, que acessaram
--    hoje e nos últimos 7 dias, sem acesso há mais de 7 dias, que nunca
--    acessaram, números de WhatsApp, volume de mensagens, pendências,
--    alertas e demandas, com a lista de usuários e o último acesso.
-- =====================================================================

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- o painel aberto avisa que o usuário está ativo (no máximo uma gravação por minuto)
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now()
   where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
$$;
revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

create or replace function public.platform_monitor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma vê o acompanhamento.' using errcode = '42501';
  end if;
  return coalesce((
    with u as (
      select p.id, p.company_id, coalesce(nullif(btrim(p.full_name), ''), p.email) as name, p.email, p.role,
             p.platform_admin,
             -- último acesso: o painel aberto (last_seen_at) ou o último login
             greatest(p.last_seen_at, a.last_sign_in_at) as last_access,
             p.last_seen_at >= now() - interval '3 minutes' as online
        from public.profiles p
        left join auth.users a on a.id = p.id
       where p.active and p.company_id is not null
    ),
    msgs as (
      select g.company_id,
             count(*) filter (where m.sent_at >= v_today) as today,
             count(*) as d7
        from public.messages m join public.groups g on g.id = m.group_id
       where m.sent_at >= now() - interval '7 days'
       group by g.company_id
    ),
    pmsgs as (
      select company_id, count(*) filter (where sent_at >= v_today) as today, count(*) as d7
        from public.private_messages where sent_at >= now() - interval '7 days'
       group by company_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'active', c.active, 'created_at', c.created_at,
      'users', (select count(*) from u where u.company_id = c.id),
      'online', (select count(*) from u where u.company_id = c.id and u.online),
      'today', (select count(*) from u where u.company_id = c.id and u.last_access >= v_today),
      'week', (select count(*) from u where u.company_id = c.id and u.last_access >= now() - interval '7 days'),
      'idle_7d', (select count(*) from u where u.company_id = c.id and u.last_access < now() - interval '7 days'),
      'never', (select count(*) from u where u.company_id = c.id and u.last_access is null),
      'last_access', (select max(u.last_access) from u where u.company_id = c.id),
      'numbers', (select count(*) from public.whatsapp_instances w where w.company_id = c.id),
      'numbers_connected', (select count(*) from public.whatsapp_instances w where w.company_id = c.id and w.status = 'connected'),
      'numbers_list', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(w.push_name, ''), w.name), 'phone', w.phone,
                                                                    'status', w.status, 'last_seen_at', w.last_seen_at) order by w.name)
                                  from public.whatsapp_instances w where w.company_id = c.id), '[]'::jsonb),
      'groups', (select count(*) from public.groups g where g.company_id = c.id and g.monitored and g.removed_at is null),
      'groups_waiting', (select count(*) from public.groups g where g.company_id = c.id and g.monitored and g.removed_at is null and g.pending_since is not null),
      'messages_today', coalesce((select today from msgs where msgs.company_id = c.id), 0),
      'messages_7d', coalesce((select d7 from msgs where msgs.company_id = c.id), 0),
      'private_today', coalesce((select today from pmsgs where pmsgs.company_id = c.id), 0),
      'private_7d', coalesce((select d7 from pmsgs where pmsgs.company_id = c.id), 0),
      'private_waiting', (select count(*) from public.private_chats pc where pc.company_id = c.id and pc.assigned_to is null and pc.closed_at is null and pc.last_message_at is not null),
      'alerts_open', (select count(*) from public.alerts al where al.company_id = c.id and al.status <> 'resolved'),
      'demands_open', (select count(*) from public.demands d where d.company_id = c.id and d.status in ('aberta', 'em_andamento')),
      'demands_overdue', (select count(*) from public.demands d where d.company_id = c.id and d.status in ('aberta', 'em_andamento') and d.promised_at < now()),
      'last_activity', (select max(l.created_at) from public.activity_log l where l.company_id = c.id),
      'people', coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'role', u.role,
                                                              'platform_admin', u.platform_admin,
                                                              'last_access', u.last_access, 'online', coalesce(u.online, false))
                                           order by coalesce(u.online, false) desc, u.last_access desc nulls last, u.name)
                            from u where u.company_id = c.id), '[]'::jsonb)
    ) order by c.active desc, c.name)
    from public.companies c
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platform_monitor() from public, anon;
grant execute on function public.platform_monitor() to authenticated;
