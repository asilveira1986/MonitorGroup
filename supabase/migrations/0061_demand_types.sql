-- =====================================================================
-- Cadastro de tipos de demanda (Configurações › Tipos de demanda).
--
-- Os tipos continuam guardados nas categorias do indicador "Tipo de
-- demanda" (o worker usa as palavras-chave para classificar a demanda).
-- rename_demand_type(): ao renomear um tipo, as demandas da empresa que
-- usavam o nome antigo passam para o novo.
-- =====================================================================

create or replace function public.rename_demand_type(p_old text, p_new text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores alteram os tipos de demanda' using errcode = '42501';
  end if;
  if coalesce(trim(p_old), '') = '' or coalesce(trim(p_new), '') = '' or trim(p_old) = trim(p_new) then
    return 0;
  end if;
  update public.demands set type = trim(p_new), updated_at = now()
   where company_id = public.current_company_id() and type = trim(p_old);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.rename_demand_type(text, text) from public, anon;
grant execute on function public.rename_demand_type(text, text) to authenticated;
