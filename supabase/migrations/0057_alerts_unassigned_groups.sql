-- =====================================================================
-- Grupo sem responsável avisa todo mundo: quem está com "avisos só dos
-- seus grupos" também recebe os avisos dos grupos que não têm responsável.
-- (No WhatsApp/e-mail o worker faz a mesma conta.)
-- =====================================================================

create or replace function public.my_alert_groups()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select case when exists (
           select 1 from public.team_members t join public.profiles p on lower(p.email) = lower(t.user_email)
            where p.id = auth.uid() and t.company_id = public.current_company_id() and t.alerts_own_groups_only)
    then coalesce((
      select array_agg(g.id) from public.groups g
       where g.company_id = public.current_company_id()
         and (cardinality(g.responsible_member_ids) = 0
              or exists (select 1 from public.team_members t join public.profiles p on lower(p.email) = lower(t.user_email)
                          where p.id = auth.uid() and t.id = any(g.responsible_member_ids)))), '{}')
    else null end
$$;
revoke all on function public.my_alert_groups() from public, anon;
grant execute on function public.my_alert_groups() to authenticated;
