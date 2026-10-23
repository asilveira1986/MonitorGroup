-- =====================================================================
-- Todos os usuários respondem em todos os grupos que veem.
--
-- A permissão "Responder pelo sistema" deixa de ser por setor: quem vê o
-- grupo (pelo setor, por ser responsável ou por ser administrador) pode
-- responder por ele. O perfil "só visualizar" continua só vendo, e a chave
-- geral "Responder pelo sistema" (Configurações › Atendimento) continua
-- valendo. "Quem pode responder" passa a "todos" nas empresas.
-- =====================================================================

update public.sectors set can_reply = true where not can_reply;
alter table public.sectors alter column can_reply set default true;
update public.app_settings set reply_allowed = 'all' where reply_allowed is distinct from 'all';

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
               when 'reply' then true  -- todos respondem nos grupos que veem (0094)
               when 'demands' then s.can_manage_demands
               when 'alerts' then s.can_handle_alerts
               else false
             end
     ))
$$;
