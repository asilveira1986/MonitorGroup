-- =====================================================================
-- Retira o "Silenciar grupo" (0052): os avisos de todos os grupos voltam
-- ao normal. Apaga a tabela de grupos silenciados, as funções e a
-- permissão "Silenciar" dos setores.
-- =====================================================================

drop function if exists public.set_group_mute(uuid, timestamptz);
drop function if exists public.set_company_mute(timestamptz);
drop table if exists public.group_mutes;

-- permissões dos setores sem o "mute"
create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = p_group_id and company_id = public.current_company_id())
     and public.is_active_user()
     and (p_permission = 'view' or public.can_write())
     and (public.is_admin() or exists (
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

alter table public.sectors drop column if exists can_mute;
