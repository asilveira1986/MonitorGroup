-- =====================================================================
-- O responsável sempre vê (e entrega) as próprias demandas.
--
-- Antes, a demanda de um grupo fora dos setores do usuário não aparecia
-- para ele (nem na lista de Demandas nem na Agenda), embora contasse no
-- número do menu e no aviso do dia. Agora a leitura das demandas inclui as
-- que têm o usuário como responsável (e a linha do tempo delas), e a
-- proteção de escrita por setor deixa o responsável marcar a entrega.
-- =====================================================================

drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select
  using (group_id in (select unnest(public.visible_group_ids()))
         or (company_id = (select public.current_company_id())
             and assignee_id = any(public.my_team_member_ids())));

create or replace function public.guard_group_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_perm  text := tg_argv[0];
begin
  if not public.acting_user() then
    return coalesce(new, old);  -- worker / chave de serviço
  end if;

  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;

  if tg_table_name = 'groups' then
    -- só administradores mudam o setor do grupo
    if tg_op = 'UPDATE' and new.sector_id is distinct from old.sector_id and not public.is_admin() then
      raise exception 'Só administradores mudam o setor de um grupo.' using errcode = '42501';
    end if;
    v_group := coalesce(new.id, old.id);
  else
    v_group := coalesce(new.group_id, old.group_id);
  end if;

  -- alerta sem grupo: qualquer usuário que pode alterar dados trata
  if v_group is null then
    return coalesce(new, old);
  end if;

  -- o responsável marca a própria demanda como entregue, mesmo fora do setor (0063);
  -- só a entrega: responsável, prazo, descrição e tipo continuam iguais
  -- (os campos da demanda só são lidos em gravações de demandas: as outras tabelas não os têm)
  if tg_table_name = 'demands' and tg_op = 'UPDATE' then
    if new.status = 'entregue' and old.status is distinct from 'entregue'
       and new.assignee_id is not distinct from old.assignee_id
       and new.promised_at is not distinct from old.promised_at
       and new.description is not distinct from old.description
       and new.type is not distinct from old.type
       and new.assignee_id = any(public.my_team_member_ids()) then
      return new;
    end if;
  end if;

  if not public.has_group_permission(v_group, v_perm) then
    raise exception '%', case v_perm
      when 'reply' then 'Seu setor não tem permissão para responder neste grupo.'
      when 'demands' then 'Seu setor não tem permissão para gerenciar demandas deste grupo.'
      when 'alerts' then 'Seu setor não tem permissão para tratar alertas deste grupo.'
      else 'Este grupo não pertence ao seu setor.' end
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
