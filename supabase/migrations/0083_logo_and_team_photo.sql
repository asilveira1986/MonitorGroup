-- =====================================================================
-- Logo da empresa e foto dos atendentes.
--
--  * companies.logo_path: logo enviado em Configurações › Empresa; aparece
--    no menu lateral, ao lado do nome da empresa.
--  * team_members.photo_path: foto enviada no cadastro do atendente.
-- As imagens ficam no bucket privado "media" (<empresa>/branding/... e
-- <empresa>/team/...) e abrem por link temporário.
-- =====================================================================

alter table public.companies add column if not exists logo_path text;
alter table public.team_members add column if not exists photo_path text;

-- logo da empresa atual (p_path null = tirar); só administradores da empresa
create or replace function public.set_company_logo(p_path text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if not (public.is_admin() or public.is_platform_admin()) then
    raise exception 'Só administradores mudam o logo da empresa.' using errcode = '42501';
  end if;
  if p_path is not null and p_path not like v_company::text || '/branding/%' then
    raise exception 'Arquivo inválido.';
  end if;
  update public.companies set logo_path = p_path where id = v_company;
end;
$$;
revoke all on function public.set_company_logo(text) from public, anon;
grant execute on function public.set_company_logo(text) to authenticated;

-- foto do atendente (p_path null = tirar)
create or replace function public.set_team_member_photo(p_member_id uuid, p_path text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if not public.can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.team_members where id = p_member_id and company_id = v_company) then
    raise exception 'Atendente não encontrado.';
  end if;
  if p_path is not null and p_path not like v_company::text || '/team/%' then
    raise exception 'Arquivo inválido.';
  end if;
  update public.team_members set photo_path = p_path where id = p_member_id;
end;
$$;
revoke all on function public.set_team_member_photo(uuid, text) from public, anon;
grant execute on function public.set_team_member_photo(uuid, text) to authenticated;
