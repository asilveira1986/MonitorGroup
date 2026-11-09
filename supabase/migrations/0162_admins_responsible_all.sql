-- =====================================================================
-- Administradores são responsáveis por todos os grupos.
--
--  * app_settings.admins_responsible_all (padrão: ligado): os administradores
--    da empresa passam a valer como responsáveis de TODOS os grupos, além dos
--    responsáveis escolhidos em cada grupo. Efeito:
--      - nas telas, ao lado dos responsáveis do grupo aparece "administradores";
--      - no Painel de grupos, filtrar por um administrador mostra todos os grupos;
--      - na automação de atendimento, a cobrança que marca "os responsáveis do
--        grupo" também marca os administradores (que tenham telefone cadastrado).
--    "Sem responsável" continua querendo dizer "nenhuma pessoa escolhida no
--    grupo" (para achar os grupos sem dono).
--  * admin_team_member_ids(): as pessoas da equipe ligadas, pelo e-mail de
--    acesso, a um administrador ativo da empresa.
-- =====================================================================

alter table public.app_settings
  add column if not exists admins_responsible_all boolean not null default true;

create or replace function public.admin_team_member_ids()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct t.id), '{}')
  from public.team_members t
  join public.profiles p on lower(btrim(p.email)) = lower(btrim(t.user_email))
  where t.company_id = public.current_company_id()
    and p.company_id = public.current_company_id()
    and t.active
    and p.active
    and (p.role = 'admin' or p.platform_admin)
$$;
revoke all on function public.admin_team_member_ids() from public, anon;
grant execute on function public.admin_team_member_ids() to authenticated;
