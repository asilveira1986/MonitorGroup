-- =====================================================================
-- Setores: cada grupo pertence a um setor; os usuários do setor só veem
-- (e só agem sobre) os grupos do seu setor. Administradores veem tudo.
--
--  * sectors:         setor com as permissões dos seus usuários
--                     (responder pelo sistema, gerenciar demandas, tratar alertas).
--                     Ver grupos e conversas é a base: todo membro vê os grupos do setor.
--  * sector_members:  usuários de cada setor (um usuário pode estar em mais de um).
--  * groups.sector_id: setor do grupo (um só). Grupo sem setor: só administradores veem.
--  * app_settings.default_sector_id: setor que os grupos novos recebem automaticamente.
--
-- Como a regra é aplicada:
--  1) leitura: RLS nas tabelas com dados de grupos (grupos, mensagens, alertas,
--     demandas, fila de envio). Os cálculos (indicadores, Painel de grupos, SLA,
--     estatísticas do grupo) passam a rodar com as permissões de quem pede, então
--     também ficam restritos aos grupos visíveis.
--  2) escrita: gatilhos conferem a permissão do setor do grupo em qualquer caminho
--     (tela ou função do banco): responder, demandas, alertas e alterações no grupo.
--     O worker (chave de serviço) não é afetado.
--
-- Transição: na primeira execução é criado o setor "Geral" com todos os grupos e
-- usuários atuais e todas as permissões; ninguém perde acesso. Depois, organize
-- em Configurações › Setores.
-- =====================================================================

create table if not exists public.sectors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  description        text,
  can_reply          boolean not null default true,
  can_manage_demands boolean not null default true,
  can_handle_alerts  boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.sector_members (
  sector_id  uuid not null references public.sectors(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sector_id, user_id)
);
create index if not exists sector_members_user_idx on public.sector_members (user_id);

alter table public.groups add column if not exists sector_id uuid references public.sectors(id) on delete set null;
create index if not exists groups_sector_idx on public.groups (sector_id);

alter table public.app_settings
  add column if not exists default_sector_id uuid references public.sectors(id) on delete set null;

-- ---------------------------------------------------------------------
-- Funções de permissão
-- ---------------------------------------------------------------------

-- grupos que o usuário atual vê pelos seus setores (administrador: use is_admin())
create or replace function public.visible_group_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(g.id), '{}')
  from public.groups g
  join public.sector_members sm on sm.sector_id = g.sector_id
  join public.profiles p on p.id = sm.user_id and p.active
  where sm.user_id = auth.uid()
$$;

-- pode ver o grupo?
create or replace function public.can_view_group(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or p_group_id = any(public.visible_group_ids())
$$;

-- permissão do usuário atual no grupo: 'view' | 'reply' | 'demands' | 'alerts'
create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.groups g
    join public.sectors s on s.id = g.sector_id
    join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
    join public.profiles p on p.id = sm.user_id and p.active
    where g.id = p_group_id
      and case p_permission
            when 'view' then true
            when 'reply' then s.can_reply
            when 'demands' then s.can_manage_demands
            when 'alerts' then s.can_handle_alerts
            else false
          end
  )
$$;

-- é um usuário logado (e não o worker/chave de serviço)?
create or replace function public.acting_user()
returns boolean
language sql stable
as $$ select auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' $$;

-- permissões do usuário atual (para as telas): grupos por permissão
create or replace function public.my_permissions()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'admin', public.is_admin(),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'can_reply', s.can_reply,
                                          'can_manage_demands', s.can_manage_demands,
                                          'can_handle_alerts', s.can_handle_alerts) order by s.name)
      from public.sectors s join public.sector_members sm on sm.sector_id = s.id
      where sm.user_id = auth.uid()), '[]'::jsonb),
    'reply_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid() where s.can_reply), '[]'::jsonb),
    'demand_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid() where s.can_manage_demands), '[]'::jsonb),
    'alert_groups', coalesce((
      select jsonb_agg(g.id) from public.groups g join public.sectors s on s.id = g.sector_id
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid() where s.can_handle_alerts), '[]'::jsonb)
  )
  where public.is_active_user()
$$;

revoke all on function public.visible_group_ids() from public, anon;
revoke all on function public.can_view_group(uuid) from public, anon;
revoke all on function public.has_group_permission(uuid, text) from public, anon;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.visible_group_ids() to authenticated;
grant execute on function public.can_view_group(uuid) to authenticated;
grant execute on function public.has_group_permission(uuid, text) to authenticated;
grant execute on function public.my_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- Setores e membros: todos os usuários ativos leem; só administradores alteram
-- ---------------------------------------------------------------------
alter table public.sectors enable row level security;
alter table public.sector_members enable row level security;

drop policy if exists sectors_read on public.sectors;
create policy sectors_read on public.sectors for select using (public.is_active_user());
drop policy if exists sectors_write on public.sectors;
create policy sectors_write on public.sectors for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists sector_members_read on public.sector_members;
create policy sector_members_read on public.sector_members for select
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists sector_members_write on public.sector_members;
create policy sector_members_write on public.sector_members for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Leitura restrita aos grupos do setor
-- (o subselect faz o Postgres calcular a lista uma vez por consulta, não por linha)
-- ---------------------------------------------------------------------
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select
  using ((select public.is_admin()) or id in (select unnest(public.visible_group_ids())));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update
  using ((select public.is_admin()) or id in (select unnest(public.visible_group_ids())))
  with check ((select public.is_admin()) or id in (select unnest(public.visible_group_ids())));

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select
  using ((select public.is_admin()) or group_id in (select unnest(public.visible_group_ids())));

-- alertas sem grupo (ex.: WhatsApp desconectado) continuam visíveis para todos
drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select
  using ((select public.is_admin())
         or (group_id is null and (select public.is_active_user()))
         or group_id in (select unnest(public.visible_group_ids())));
drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts for update
  using ((select public.is_admin())
         or (group_id is null and (select public.is_active_user()))
         or group_id in (select unnest(public.visible_group_ids())))
  with check ((select public.is_admin())
              or (group_id is null and (select public.is_active_user()))
              or group_id in (select unnest(public.visible_group_ids())));

drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select
  using ((select public.is_admin()) or group_id in (select unnest(public.visible_group_ids())));

drop policy if exists demand_events_read on public.demand_events;
create policy demand_events_read on public.demand_events for select
  using ((select public.is_admin()) or demand_id in (select d.id from public.demands d));

drop policy if exists outgoing_read on public.outgoing_messages;
create policy outgoing_read on public.outgoing_messages for select
  using ((select public.is_admin()) or group_id in (select unnest(public.visible_group_ids())));

-- ---------------------------------------------------------------------
-- Escrita: confere a permissão do setor em qualquer caminho (tela ou função)
-- ---------------------------------------------------------------------
create or replace function public.guard_group_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
  v_perm  text := tg_argv[0];
begin
  if not public.acting_user() then
    return coalesce(new, old);  -- worker / chave de serviço
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

  -- alerta sem grupo: qualquer usuário ativo trata
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

drop trigger if exists outgoing_guard on public.outgoing_messages;
create trigger outgoing_guard before insert or update or delete on public.outgoing_messages
  for each row execute function public.guard_group_write('reply');

drop trigger if exists demands_guard on public.demands;
create trigger demands_guard before insert or update or delete on public.demands
  for each row execute function public.guard_group_write('demands');

drop trigger if exists alerts_guard on public.alerts;
create trigger alerts_guard before update or delete on public.alerts
  for each row execute function public.guard_group_write('alerts');

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update or delete on public.messages
  for each row execute function public.guard_group_write('view');

drop trigger if exists groups_guard on public.groups;
create trigger groups_guard before update or delete on public.groups
  for each row execute function public.guard_group_write('view');

-- grupo novo recebe o setor padrão
create or replace function public.groups_default_sector()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sector_id is null then
    select default_sector_id into new.sector_id from public.app_settings where id = 1;
  end if;
  return new;
end;
$$;
drop trigger if exists groups_default_sector on public.groups;
create trigger groups_default_sector before insert on public.groups
  for each row execute function public.groups_default_sector();

-- ---------------------------------------------------------------------
-- Cálculos com as permissões de quem pede (respeitam os setores)
-- ---------------------------------------------------------------------
alter function public.indicator_values(timestamptz, timestamptz, uuid, uuid) security invoker;
alter function public.indicator_details(text, timestamptz, timestamptz, uuid, uuid) security invoker;
alter function public.groups_panel() security invoker;
alter function public.sla_breaches() security invoker;
alter function public.group_stats(uuid, int) security invoker;
alter function public.dashboard_metrics(timestamptz, timestamptz, uuid) security invoker;

-- as funções de cálculo só leem dados (e agora sob RLS): podem ser chamadas por usuários
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'ind\_%' escape '\'
                  or p.proname in ('business_seconds', 'is_business_time', 'reply_signal', 'team_close_kind',
                                   'sla_business_time_only'))
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Transição: setor "Geral" com tudo o que existe hoje
-- ---------------------------------------------------------------------
do $$
declare v_sector uuid;
begin
  if not exists (select 1 from public.sectors) then
    insert into public.sectors (name, description)
    values ('Geral', 'Criado na atualização com todos os grupos e usuários. Reorganize em Configurações › Setores.')
    returning id into v_sector;
    update public.groups set sector_id = v_sector where sector_id is null;
    insert into public.sector_members (sector_id, user_id)
    select v_sector, id from public.profiles on conflict do nothing;
    update public.app_settings set default_sector_id = v_sector where id = 1;
  end if;
end $$;

-- tempo real: avisos de setores e membros mudam a tela na hora
do $$
begin
  begin alter publication supabase_realtime add table public.sectors; exception when others then null; end;
  begin alter publication supabase_realtime add table public.sector_members; exception when others then null; end;
end $$;

notify pgrst, 'reload schema';
