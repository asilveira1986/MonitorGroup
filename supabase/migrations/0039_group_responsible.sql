-- =====================================================================
-- Responsável pelo grupo.
--
-- Cada grupo pode ter um responsável, escolhido entre as pessoas da equipe
-- (Configurações › Equipe) da própria empresa. Ele aparece na tela do grupo,
-- na lista de grupos e no painel (com filtro por responsável), e as demandas
-- abertas no grupo sem responsável definido já nascem com ele.
-- =====================================================================

alter table public.groups
  add column if not exists responsible_member_id uuid references public.team_members(id) on delete set null;

create index if not exists groups_responsible_idx on public.groups (responsible_member_id)
  where responsible_member_id is not null;

-- o responsável precisa ser da equipe da mesma empresa do grupo
create or replace function public.check_group_responsible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.responsible_member_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.responsible_member_id is not distinct from old.responsible_member_id then
      return new;
    end if;
  end if;
  if not exists (select 1 from public.team_members t
                     where t.id = new.responsible_member_id and t.company_id = new.company_id) then
    raise exception 'O responsável precisa ser uma pessoa da equipe desta empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_check_responsible on public.groups;
create trigger groups_check_responsible before insert or update of responsible_member_id on public.groups
  for each row execute function public.check_group_responsible();

-- demanda sem responsável: fica com o responsável do grupo
create or replace function public.demand_default_assignee()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.assignee_id is null then
    select g.responsible_member_id into new.assignee_id from public.groups g where g.id = new.group_id;
  end if;
  return new;
end;
$$;

drop trigger if exists demands_default_assignee on public.demands;
create trigger demands_default_assignee before insert on public.demands
  for each row execute function public.demand_default_assignee();
