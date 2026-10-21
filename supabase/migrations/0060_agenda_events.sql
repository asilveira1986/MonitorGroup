-- =====================================================================
-- Agenda: compromissos registrados à mão.
--
-- Cada compromisso é da agenda de uma pessoa da equipe (a mesma agenda das
-- demandas). A própria pessoa (usuário com o e-mail de acesso dela) e os
-- administradores criam, editam, concluem e excluem.
-- my_due_demands() passa a contar também os compromissos de hoje.
-- =====================================================================

create table if not exists public.agenda_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  member_id   uuid not null references public.team_members(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 200),
  notes       text check (notes is null or length(notes) <= 2000),
  starts_at   timestamptz not null,
  all_day     boolean not null default false,
  done_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agenda_events_member_idx on public.agenda_events (member_id, starts_at);

-- a pessoa da agenda precisa ser da equipe da mesma empresa
create or replace function public.check_agenda_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.team_members t where t.id = new.member_id and t.company_id = new.company_id) then
    raise exception 'A agenda precisa ser de uma pessoa da equipe desta empresa.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists agenda_events_check on public.agenda_events;
create trigger agenda_events_check before insert or update on public.agenda_events
  for each row execute function public.check_agenda_event();

alter table public.agenda_events enable row level security;
drop policy if exists agenda_events_read on public.agenda_events;
create policy agenda_events_read on public.agenda_events for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id())
         and ((select public.is_admin()) or member_id = any(public.my_team_member_ids())));
drop policy if exists agenda_events_write on public.agenda_events;
create policy agenda_events_write on public.agenda_events for all
  using ((select public.can_write()) and company_id = (select public.current_company_id())
         and ((select public.is_admin()) or member_id = any(public.my_team_member_ids())))
  with check ((select public.can_write()) and company_id = (select public.current_company_id())
         and ((select public.is_admin()) or member_id = any(public.my_team_member_ids())));
grant select, insert, update, delete on public.agenda_events to authenticated;

-- aviso do dia: demandas para hoje, atrasadas e compromissos de hoje
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
                        and e.member_id = any(public.my_team_member_ids())
                        and e.done_at is null
                        and (e.starts_at at time zone cfg.tz)::date = (now() at time zone cfg.tz)::date
                        and (e.all_day or e.starts_at >= now()))
  )
$$;
revoke all on function public.my_due_demands() from public, anon;
grant execute on function public.my_due_demands() to authenticated;
