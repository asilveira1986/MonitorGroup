-- =====================================================================
-- Agenda independente, por usuário, com setores da agenda e o perfil
-- "Só agenda".
--
--  * Cada usuário (login) tem a sua agenda: compromissos sem demanda e sem
--    precisar de cadastro na equipe. Um compromisso tem quem o criou (dono)
--    e os participantes (agenda_event_people); aparece na agenda de cada
--    participante. Os compromissos antigos (de uma pessoa da equipe) seguem
--    aparecendo para o usuário ligado a ela.
--  * Setores da agenda (agenda_teams): listas de usuários; ao marcar um
--    compromisso, escolher um setor já marca todos, e dá para desmarcar.
--  * Perfil "Só agenda" (role 'agenda'): entra só na Agenda (e no perfil);
--    não vê grupos, conversas, demandas nem alertas.
-- =====================================================================

-- perfil "Só agenda"
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'agent', 'viewer', 'agenda'));
alter table public.allowed_emails drop constraint if exists allowed_emails_role_check;
alter table public.allowed_emails add constraint allowed_emails_role_check check (role in ('admin', 'agent', 'viewer', 'agenda'));

-- "Só agenda" não vê grupo nenhum (e, por isso, nada de conversas, demandas e alertas dos grupos)
create or replace function public.visible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active_user() then '{}'::uuid[]
    when exists (select 1 from public.profiles where id = auth.uid() and role = 'agenda' and not platform_admin) then '{}'::uuid[]
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

-- compromissos: dono (usuário) e participantes; a pessoa da equipe fica opcional (antigos)
alter table public.agenda_events add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.agenda_events alter column member_id drop not null;
update public.agenda_events set owner_id = created_by where owner_id is null;

create table if not exists public.agenda_event_people (
  event_id   uuid not null references public.agenda_events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (event_id, user_id)
);
create index if not exists agenda_event_people_user_idx on public.agenda_event_people (user_id);

-- os antigos: participante = o usuário ligado à pessoa da equipe
insert into public.agenda_event_people (event_id, user_id, company_id)
select e.id, p.id, e.company_id
  from public.agenda_events e
  join public.team_members t on t.id = e.member_id
  join public.profiles p on lower(p.email) = lower(t.user_email) and p.company_id = e.company_id
on conflict do nothing;

create or replace function public.check_agenda_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.member_id is not null
     and not exists (select 1 from public.team_members t where t.id = new.member_id and t.company_id = new.company_id) then
    raise exception 'A agenda precisa ser de uma pessoa da equipe desta empresa.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- quem vê / mexe no compromisso
create or replace function public.can_see_agenda_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agenda_events e
     where e.id = p_event_id and e.company_id = public.current_company_id() and public.is_active_user()
       and (public.is_admin() or e.owner_id = auth.uid()
            or e.member_id = any(public.my_team_member_ids())
            or exists (select 1 from public.agenda_event_people x where x.event_id = e.id and x.user_id = auth.uid())))
$$;
create or replace function public.can_edit_agenda_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agenda_events e
     where e.id = p_event_id and e.company_id = public.current_company_id() and public.can_write()
       and (public.is_admin() or e.owner_id = auth.uid() or e.member_id = any(public.my_team_member_ids())
            -- participante conclui/reabre e edita o que está na própria agenda
            or exists (select 1 from public.agenda_event_people x where x.event_id = e.id and x.user_id = auth.uid())))
$$;
grant execute on function public.can_see_agenda_event(uuid), public.can_edit_agenda_event(uuid) to authenticated;

drop policy if exists agenda_events_read on public.agenda_events;
create policy agenda_events_read on public.agenda_events for select using (public.can_see_agenda_event(id));
drop policy if exists agenda_events_write on public.agenda_events;
drop policy if exists agenda_events_update on public.agenda_events;
create policy agenda_events_update on public.agenda_events for update
  using (public.can_edit_agenda_event(id)) with check (company_id = (select public.current_company_id()));
drop policy if exists agenda_events_delete on public.agenda_events;
create policy agenda_events_delete on public.agenda_events for delete using (public.can_edit_agenda_event(id));
-- criar: pelo save_agenda_event (escolhe os participantes)

alter table public.agenda_event_people enable row level security;
drop policy if exists agenda_event_people_read on public.agenda_event_people;
create policy agenda_event_people_read on public.agenda_event_people for select using (public.can_see_agenda_event(event_id));
grant select on public.agenda_event_people to authenticated;

-- setores da agenda
create table if not exists public.agenda_teams (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create table if not exists public.agenda_team_members (
  team_id uuid not null references public.agenda_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (team_id, user_id)
);
alter table public.agenda_teams enable row level security;
alter table public.agenda_team_members enable row level security;
drop policy if exists agenda_teams_read on public.agenda_teams;
create policy agenda_teams_read on public.agenda_teams for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
drop policy if exists agenda_teams_write on public.agenda_teams;
create policy agenda_teams_write on public.agenda_teams for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));
drop policy if exists agenda_team_members_read on public.agenda_team_members;
create policy agenda_team_members_read on public.agenda_team_members for select
  using (exists (select 1 from public.agenda_teams t where t.id = team_id));
drop policy if exists agenda_team_members_write on public.agenda_team_members;
create policy agenda_team_members_write on public.agenda_team_members for all
  using ((select public.is_admin()) and exists (select 1 from public.agenda_teams t where t.id = team_id))
  with check ((select public.is_admin()) and exists (select 1 from public.agenda_teams t where t.id = team_id));
grant select, insert, update, delete on public.agenda_teams, public.agenda_team_members to authenticated;

-- pessoas da agenda: os usuários ativos da empresa (para escolher participantes), com as pessoas da
-- equipe ligadas a cada um (demandas na agenda)
create or replace function public.agenda_people()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)),
           'role', p.role,
           'member_ids', coalesce((select jsonb_agg(t.id) from public.team_members t
                                    where t.company_id = p.company_id and lower(t.user_email) = lower(p.email)), '[]'::jsonb))
           order by coalesce(nullif(btrim(p.full_name), ''), p.email)), '[]'::jsonb)
    from public.profiles p
   where public.is_active_user() and p.company_id = public.current_company_id() and p.active
$$;
grant execute on function public.agenda_people() to authenticated;

-- criar / editar um compromisso com os participantes (p_id null = novo)
create or replace function public.save_agenda_event(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_title text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  v_people uuid[];
  v_id uuid := p_id;
begin
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  if v_title is null then
    raise exception 'Informe o título do compromisso.';
  end if;
  if p_starts_at is null then
    raise exception 'Informe a data do compromisso.';
  end if;
  -- só usuários ativos desta empresa; sem ninguém, fica na agenda de quem criou
  select coalesce(array_agg(distinct p.id), '{}') into v_people
    from public.profiles p where p.id = any(coalesce(p_people, '{}')) and p.company_id = v_company and p.active;
  if cardinality(v_people) = 0 then
    v_people := array[auth.uid()];
  end if;

  if v_id is null then
    insert into public.agenda_events (company_id, owner_id, created_by, title, notes, starts_at, all_day)
    values (v_company, auth.uid(), auth.uid(), left(v_title, 200), nullif(left(btrim(coalesce(p_notes, '')), 2000), ''), p_starts_at, coalesce(p_all_day, false))
    returning id into v_id;
  else
    if not public.can_edit_agenda_event(v_id) then
      raise exception 'Compromisso não encontrado.';
    end if;
    update public.agenda_events
       set title = left(v_title, 200), notes = nullif(left(btrim(coalesce(p_notes, '')), 2000), ''),
           starts_at = p_starts_at, all_day = coalesce(p_all_day, false)
     where id = v_id;
    delete from public.agenda_event_people where event_id = v_id and user_id <> all(v_people);
  end if;
  insert into public.agenda_event_people (event_id, user_id, company_id)
  select v_id, u, v_company from unnest(v_people) u
  on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[]) from public, anon;
grant execute on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[]) to authenticated;

-- aviso do dia: demandas (da pessoa da equipe ligada) e compromissos em que o usuário participa
create or replace function public.my_due_demands()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with cfg as (
    select coalesce((select timezone from public.app_settings where company_id = public.current_company_id()),
                    'America/Sao_Paulo') as tz
  ), mine as (
    select d.promised_at from public.demands d
    where d.company_id = public.current_company_id()
      and d.status in ('aberta', 'em_andamento')
      and d.assignee_id = any(public.my_team_member_ids())
      and d.promised_at is not null
  )
  select jsonb_build_object(
    'hoje', (select count(*) from mine, cfg
              where (promised_at at time zone cfg.tz)::date = (now() at time zone cfg.tz)::date and promised_at >= now()),
    'atrasadas', (select count(*) from mine where promised_at < now()),
    'compromissos', (select count(*) from public.agenda_events e, cfg
                      where e.company_id = public.current_company_id()
                        and (e.member_id = any(public.my_team_member_ids())
                             or exists (select 1 from public.agenda_event_people x where x.event_id = e.id and x.user_id = auth.uid()))
                        and e.done_at is null
                        and (e.starts_at at time zone cfg.tz)::date = (now() at time zone cfg.tz)::date
                        and (e.all_day or e.starts_at >= now()))
  )
$$;
