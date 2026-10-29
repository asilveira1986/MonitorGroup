-- =====================================================================
-- Setor padrão ("Geral") vê tudo.
--
--  * Quem é do setor padrão da empresa (Configurações › Setores; sem setor
--    padrão definido, o setor chamado "Geral") vê os grupos de todos os
--    números conectados, com as permissões do setor padrão (demandas,
--    alertas), e todas as conversas privadas, inclusive as que estão com
--    outro usuário.
--  * Transferir/devolver a conversa de outro usuário continua sendo do
--    responsável ou de um administrador.
-- =====================================================================

-- o setor padrão da empresa
create or replace function public.general_sector_id(p_company uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.default_sector_id from public.app_settings a
       join public.sectors s on s.id = a.default_sector_id
      where a.company_id = p_company),
    (select s.id from public.sectors s where s.company_id = p_company and lower(btrim(s.name)) = 'geral' order by s.created_at limit 1))
$$;
revoke all on function public.general_sector_id(uuid) from public, anon;
grant execute on function public.general_sector_id(uuid) to authenticated;

-- o usuário é do setor padrão?
create or replace function public.in_general_sector()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sector_members m
                  where m.user_id = auth.uid() and m.sector_id = public.general_sector_id(public.current_company_id()))
$$;
revoke all on function public.in_general_sector() from public, anon;
grant execute on function public.in_general_sector() to authenticated;

-- ------------------------------------------------ grupos
create or replace function public.visible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active_user() then '{}'::uuid[]
    when exists (select 1 from public.profiles where id = auth.uid() and role = 'agenda' and not platform_admin) then '{}'::uuid[]
    when public.is_admin() or public.in_general_sector() then
      coalesce((select array_agg(g.id) from public.groups g where g.company_id = public.current_company_id()), '{}')
    else coalesce((
      select array_agg(distinct x.id) from (
        select g.id
        from public.groups g
        join public.sector_members sm on sm.sector_id = g.sector_id and sm.user_id = auth.uid()
        where g.company_id = public.current_company_id()
        union all
        select unnest(public.my_responsible_group_ids())
      ) x), '{}')
  end
$$;

create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = p_group_id and company_id = public.current_company_id())
     and public.is_active_user()
     and (p_permission = 'view' or public.can_write())
     and (public.is_admin()
          -- responsável pelo grupo: vê, responde, cuida das demandas e dos alertas
          or (p_permission in ('view', 'reply', 'demands', 'alerts') and p_group_id = any(public.my_responsible_group_ids()))
          or exists (
       select 1
       from public.groups g
       join public.sectors s on s.id = g.sector_id
                             or s.id = public.general_sector_id(g.company_id)   -- setor padrão: todos os grupos (0129)
       join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
       where g.id = p_group_id
         and case p_permission
               when 'view' then true
               when 'reply' then true  -- todos respondem nos grupos que veem (0094)
               when 'demands' then s.can_manage_demands
               when 'alerts' then s.can_handle_alerts
               else false
             end
     ))
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  with grants as (
    -- cada grupo com as permissões dos meus setores (o setor padrão vale para todos os grupos, 0129)
    select g.id, s.can_reply, s.can_manage_demands, s.can_handle_alerts
      from public.groups g
      join public.sectors s on s.id = g.sector_id or s.id = public.general_sector_id(g.company_id)
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
     where g.company_id = public.current_company_id()
  )
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
    'reply_groups', coalesce((select jsonb_agg(distinct id) from grants where can_reply), '[]'::jsonb),
    'demand_groups', coalesce((select jsonb_agg(distinct id) from grants where can_manage_demands), '[]'::jsonb),
    'alert_groups', coalesce((select jsonb_agg(distinct id) from grants where can_handle_alerts), '[]'::jsonb)
  )
  where public.is_active_user()
$$;

-- ------------------------------------------------ conversas privadas
-- vê as conversas de todos: administradores e quem é do setor padrão
create or replace function public.private_sees_team()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and (public.is_admin() or public.in_general_sector())
$$;
revoke all on function public.private_sees_team() from public, anon;
grant execute on function public.private_sees_team() to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to = auth.uid() or public.private_sees_team()
            or (c.assigned_to is null and public.private_instance_ok(c.instance_id))))
$$;

drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to = (select auth.uid()) or (select public.private_sees_team())
              or (assigned_to is null and public.private_instance_ok(instance_id))));
