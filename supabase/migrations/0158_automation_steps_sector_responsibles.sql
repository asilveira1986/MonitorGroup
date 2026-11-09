-- =====================================================================
-- Automação: cobranças em etapas e responsável do setor.
--
--  * sectors.responsible_member_ids: as pessoas da equipe responsáveis
--    pelo setor (Configurações › Setores). A automação pode marcá-las.
--  * automation_rules.escalation_steps: uma etapa por cobrança (1ª, 2ª...),
--    cada uma com quem marcar: os responsáveis do grupo do cliente, os
--    responsáveis do setor do grupo e/ou pessoas escolhidas; e, opcional,
--    o tempo daquela cobrança (waitMin). Lista vazia = como antes (todas as
--    cobranças marcam mention_jids). Passando da última etapa, repete a última.
--    Formato de cada etapa:
--      {"waitMin": 15, "mentionGroupResponsibles": true,
--       "mentionSectorResponsibles": false, "mentionJids": ["5551...@s.whatsapp.net"]}
-- =====================================================================

alter table public.sectors
  add column if not exists responsible_member_ids uuid[] not null default '{}';

alter table public.automation_rules
  add column if not exists escalation_steps jsonb not null default '[]';

do $$ begin
  alter table public.automation_rules
    add constraint automation_rules_steps_check check (jsonb_typeof(escalation_steps) = 'array' and jsonb_array_length(escalation_steps) <= 10);
exception when duplicate_object then null; end $$;

-- lista sem repetidos e só com pessoas da equipe da empresa do setor
create or replace function public.sync_sector_responsibles()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.responsible_member_ids := coalesce(array(
    select x from (select distinct on (x) x, o from unnest(new.responsible_member_ids) with ordinality u(x, o)
                    where x is not null order by x, o) d order by o), '{}');
  if exists (select 1 from unnest(new.responsible_member_ids) x
             where not exists (select 1 from public.team_members t where t.id = x and t.company_id = new.company_id)) then
    raise exception 'O responsável do setor precisa ser uma pessoa da equipe desta empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists sectors_sync_responsibles on public.sectors;
create trigger sectors_sync_responsibles before insert or update of responsible_member_ids on public.sectors
  for each row execute function public.sync_sector_responsibles();

-- pessoa removida da equipe sai da lista dos setores (e dos grupos, 0056)
create or replace function public.team_member_drop_sector_responsible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.sectors set responsible_member_ids = array_remove(responsible_member_ids, old.id)
   where old.id = any(responsible_member_ids);
  return old;
end;
$$;

drop trigger if exists team_members_drop_sector_responsible on public.team_members;
create trigger team_members_drop_sector_responsible before delete on public.team_members
  for each row execute function public.team_member_drop_sector_responsible();
