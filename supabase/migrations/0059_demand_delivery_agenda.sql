-- =====================================================================
-- Demandas: entrega pelo responsável e agenda por usuário.
--
--  * Só o responsável marca a demanda como entregue (botão "Demanda
--    entregue"). No painel, o responsável é o usuário com o e-mail de
--    acesso da pessoa da equipe (Configurações › Equipe › Dar acesso).
--    Pelo WhatsApp (#entregue), o worker aceita só a mensagem do próprio
--    responsável.
--  * my_team_member_ids(): as pessoas da equipe ligadas ao usuário logado.
--  * my_due_demands(): quantas demandas o usuário tem para entregar hoje e
--    quantas estão atrasadas (aviso do dia e número no menu Agenda).
-- =====================================================================

create or replace function public.my_team_member_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}')
  from public.team_members t join public.profiles p on lower(p.email) = lower(t.user_email)
  where p.id = auth.uid() and t.company_id = public.current_company_id()
$$;
revoke all on function public.my_team_member_ids() from public, anon;
grant execute on function public.my_team_member_ids() to authenticated;

-- entrega só pelo responsável (usuário do painel; o worker confere pelo remetente)
create or replace function public.check_demand_delivery()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' and auth.uid() is not null then
    if new.assignee_id is null then
      raise exception 'Defina o responsável da demanda: só ele pode marcar como entregue.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.team_members t join public.profiles p on lower(p.email) = lower(t.user_email)
                    where t.id = new.assignee_id and p.id = auth.uid()) then
      raise exception 'Só o responsável pela demanda (%) pode marcar como entregue.',
        coalesce((select name from public.team_members where id = new.assignee_id), '?') using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists demands_check_delivery on public.demands;
create trigger demands_check_delivery before update of status on public.demands
  for each row execute function public.check_demand_delivery();

-- para entregar hoje e atrasadas (no fuso da empresa)
create or replace function public.my_due_demands()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with cfg as (
    select coalesce((select timezone from public.app_settings where company_id = public.current_company_id()),
                    'America/Sao_Paulo') as tz
  ), mine as (
    select d.promised_at from public.demands d, cfg
    where d.company_id = public.current_company_id()
      and d.status in ('aberta', 'em_andamento')
      and d.assignee_id = any(public.my_team_member_ids())
      and d.promised_at is not null
  )
  select jsonb_build_object(
    'hoje', (select count(*) from mine, cfg
              where (promised_at at time zone cfg.tz)::date = (now() at time zone cfg.tz)::date and promised_at >= now()),
    'atrasadas', (select count(*) from mine where promised_at < now())
  )
$$;
revoke all on function public.my_due_demands() from public, anon;
grant execute on function public.my_due_demands() to authenticated;
