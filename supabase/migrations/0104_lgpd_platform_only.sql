-- =====================================================================
-- Privacidade (LGPD) só para o administrador geral do sistema.
--
-- O prazo de guarda das mensagens e os pedidos dos titulares (consultar,
-- exportar e apagar os dados de uma pessoa) passam a ser só de quem
-- administra a plataforma; os administradores das empresas não veem
-- mais a tela nem conseguem pelo banco.
-- =====================================================================

-- pedidos dos titulares (consultar, exportar, apagar): todos passam por aqui
create or replace function public.lgpd_check_admin(p_phone text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if not public.is_platform_admin() then
    raise exception 'Só o administrador geral do sistema atende pedidos de dados pessoais (LGPD).' using errcode = '42501';
  end if;
  if length(v_digits) between 10 and 11 then
    v_digits := '55' || v_digits;  -- DDD + número: Brasil
  end if;
  if length(v_digits) < 12 or length(v_digits) > 15 then
    raise exception 'Informe o telefone com DDD (e o código do país, se não for do Brasil).';
  end if;
  return v_digits;
end;
$$;
revoke all on function public.lgpd_check_admin(text) from public, anon, authenticated;


-- prazo de guarda das mensagens: só o administrador geral muda (o worker e o SQL Editor seguem livres)
create or replace function public.app_settings_guard_retention()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.message_retention_months is distinct from old.message_retention_months
     and auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'Só o administrador geral do sistema muda o prazo de guarda das mensagens (LGPD).' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists app_settings_guard_retention on public.app_settings;
create trigger app_settings_guard_retention before update of message_retention_months on public.app_settings
  for each row execute function public.app_settings_guard_retention();
