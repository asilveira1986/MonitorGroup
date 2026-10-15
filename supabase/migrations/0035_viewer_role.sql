-- =====================================================================
-- Perfil "Somente ver painéis" (role = 'viewer')
--
-- Para gestores, TVs e quem só acompanha: vê os painéis dos grupos dos
-- seus setores (dashboard, painel de grupos e a conversa dos grupos),
-- mas não altera nada: não responde, não cria nem muda demandas, não
-- trata alertas, não mexe em grupos, equipe ou configurações.
-- A regra vale no banco: qualquer escrita de um "viewer" é recusada.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'agent', 'viewer'));
alter table public.allowed_emails drop constraint if exists allowed_emails_role_check;
alter table public.allowed_emails add constraint allowed_emails_role_check check (role in ('admin', 'agent', 'viewer'));

-- pode alterar dados? (usuário ativo que não é "somente ver"; quem administra a plataforma sempre pode)
create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles where id = auth.uid() and (role <> 'viewer' or platform_admin)
  )
$$;
grant execute on function public.can_write() to authenticated;

-- permissões por grupo: "somente ver" só tem a de ver
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

create or replace function public.can_manage_demands()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_write() or coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function public.can_reply()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_write()
     and s.reply_enabled
     and (s.reply_allowed = 'all' or public.is_admin())
  from public.app_settings s where s.company_id = public.current_company_id()
$$;

-- toda escrita protegida pelos gatilhos de grupo: "somente ver" não altera nada
create or replace function public.guard_group_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_perm  text := tg_argv[0];
begin
  if not public.acting_user() then
    return coalesce(new, old);  -- worker / chave de serviço
  end if;

  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;

  if tg_table_name = 'groups' then
    -- só administradores mudam o setor do grupo
    if tg_op = 'UPDATE' and new.sector_id is distinct from old.sector_id and not public.is_admin() then
      raise exception 'Só administradores mudam o setor de um grupo.' using errcode = '42501';
    end if;
    v_group := coalesce(new.id, old.id);
  else
    v_group := coalesce(new.group_id, old.group_id);
  end if;

  -- alerta sem grupo: qualquer usuário que pode alterar dados trata
  if v_group is null then
    return coalesce(new, old);
  end if;

  if not public.has_group_permission(v_group, v_perm) then
    raise exception '%', case v_perm
      when 'reply' then 'Seu setor não tem permissão para responder neste grupo.'
      when 'demands' then 'Seu setor não tem permissão para gerenciar demandas deste grupo.'
      when 'alerts' then 'Seu setor não tem permissão para tratar alertas deste grupo.'
      else 'Este grupo não pertence ao seu setor.' end
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- equipe: "somente ver" só lê
drop policy if exists team_write on public.team_members;
create policy team_write on public.team_members for all
  using ((select public.can_write()) and company_id = (select public.current_company_id()))
  with check ((select public.can_write()) and company_id = (select public.current_company_id()));

-- marcar remetente como equipe grava na equipe sem passar pelos gatilhos: confere aqui
create or replace function public.mark_sender_as_team(p_sender_jid text, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_company uuid := public.current_company_id();
begin
  if not public.can_write() then
    raise exception 'not authorized';
  end if;
  select id into v_id from public.team_members where company_id = v_company and jid = p_sender_jid;
  if v_id is null then
    insert into public.team_members (company_id, name, jid, phone)
    values (v_company, p_name, p_sender_jid, nullif(p_phone, ''))
    returning id into v_id;
  else
    update public.team_members set name = p_name, active = true where id = v_id;
  end if;

  update public.messages m set from_team = true, team_member_id = v_id
   from public.groups g
   where g.id = m.group_id and g.company_id = v_company
     and m.sender_jid = p_sender_jid and not m.from_team;
  return v_id;
end;
$$;

notify pgrst, 'reload schema';
