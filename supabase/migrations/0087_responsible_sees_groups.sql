-- =====================================================================
-- O responsável enxerga e atende os grupos dele.
--
-- Os atendentes viam só os grupos dos setores de que participam; ser
-- responsável pelo grupo (0056) não dava acesso a ele, e a pessoa ficava
-- sem ver os próprios grupos. Agora, além dos setores, cada usuário vê os
-- grupos em que a pessoa da equipe ligada ao e-mail de acesso dele
-- (my_team_member_ids, 0059) é responsável, e neles pode responder, cuidar
-- das demandas e dos alertas (o perfil "só visualizar" continua só vendo).
-- =====================================================================

-- grupos em que o usuário logado é responsável
create or replace function public.my_responsible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(g.id), '{}')
  from public.groups g
  where g.company_id = public.current_company_id()
    and (g.responsible_member_ids && public.my_team_member_ids()
         or g.responsible_member_id = any(public.my_team_member_ids()))
$$;
revoke all on function public.my_responsible_group_ids() from public, anon;
grant execute on function public.my_responsible_group_ids() to authenticated;

create or replace function public.visible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active_user() then '{}'::uuid[]
    when public.is_admin() then
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
