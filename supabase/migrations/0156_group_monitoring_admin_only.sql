-- =====================================================================
-- Ligar/desligar o monitoramento de um grupo é só do administrador.
--
-- Até aqui, qualquer usuário que enxergasse um grupo podia mudar o campo
-- groups.monitored (a política de edição só olha se o grupo é visível).
-- Agora o banco recusa a mudança de quem não é administrador (ou
-- administrador da plataforma). Não afeta:
--   * o worker e o SQL Editor do Supabase (sem usuário logado);
--   * a regra de limite do plano (0030), que continua valendo;
--   * as demais edições do grupo (setor, responsáveis, SLA, etiquetas).
-- =====================================================================

create or replace function public.guard_group_monitoring()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.monitored is distinct from old.monitored and auth.uid() is not null and not public.is_admin() then
    raise exception 'Só administradores ligam ou desligam o monitoramento dos grupos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_monitoring_guard on public.groups;
create trigger groups_monitoring_guard before update of monitored on public.groups
  for each row execute function public.guard_group_monitoring();
