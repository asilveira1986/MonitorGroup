-- =====================================================================
-- O SLA (tempo de resposta) de cada grupo é só do administrador.
--
-- Fica na tela Grupos (só para administradores). O banco também recusa a
-- mudança de groups.sla_minutes por quem não é administrador (ou
-- administrador da plataforma), como já faz com o monitoramento (0156).
-- Não afeta o worker nem o SQL Editor (sem usuário logado).
-- =====================================================================

create or replace function public.guard_group_monitoring()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.monitored is distinct from old.monitored then
      raise exception 'Só administradores ligam ou desligam o monitoramento dos grupos.' using errcode = '42501';
    end if;
    if new.sla_minutes is distinct from old.sla_minutes then
      raise exception 'Só administradores mudam o SLA dos grupos.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists groups_monitoring_guard on public.groups;
create trigger groups_monitoring_guard before update of monitored, sla_minutes on public.groups
  for each row execute function public.guard_group_monitoring();
