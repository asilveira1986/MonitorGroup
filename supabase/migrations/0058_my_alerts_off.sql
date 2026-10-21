-- =====================================================================
-- "Meus alertas": o usuário desliga os avisos só para ele (aviso em tela,
-- voz e som), em qualquer navegador e em todas as empresas. Os alertas
-- continuam sendo criados e avisados para os demais.
-- =====================================================================

alter table public.profiles
  add column if not exists alerts_off boolean not null default false;

create or replace function public.set_my_alerts_off(p_off boolean)
returns void
language sql security definer set search_path = public
as $$
  update public.profiles set alerts_off = coalesce(p_off, false) where id = auth.uid();
$$;
revoke all on function public.set_my_alerts_off(boolean) from public, anon;
grant execute on function public.set_my_alerts_off(boolean) to authenticated;
