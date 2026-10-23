-- =====================================================================
-- Avisos automáticos ao cliente (demanda registrada/concluída) sempre vão.
--
-- O aviso entrava na fila como se fosse uma resposta de quem registrou ou
-- entregou a demanda: sem permissão de responder pelo painel naquele grupo
-- (setor sem "responder"), a fila recusava e o aviso não saía. Agora o
-- aviso é do sistema (app.system_notice) e não depende dessa permissão; e
-- vale também em grupos com o monitoramento desligado (só não em grupos de
-- que o número saiu).
-- =====================================================================

create or replace function public.guard_group_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_perm  text := tg_argv[0];
begin
  if not public.acting_user() then
    return coalesce(new, old);  -- worker / chave de serviço
  end if;
  -- avisos automáticos do sistema ao cliente (demanda registrada/concluída, 0093): não dependem da
  -- permissão de quem registrou ou entregou
  if current_setting('app.system_notice', true) = 'on' then
    return coalesce(new, old);
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

create or replace function public.demands_notify_client()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_on boolean;
  v_group public.groups%rowtype;
  v_text text;
  v_sender text;
begin
  select * into v_group from public.groups where id = new.group_id;
  if v_group.id is null or v_group.removed_at is not null then
    return new;
  end if;
  select coalesce(demand_notify_client, true) into v_on from public.app_settings where company_id = v_group.company_id;
  if not coalesce(v_on, true) then
    return new;
  end if;
  v_text := public.demand_client_notice(new);
  if nullif(btrim(v_text), '') is null then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_sender from public.profiles where id = auth.uid();
  -- o aviso nunca impede registrar a demanda (ex.: quem registrou não pode responder no grupo)
  begin
    perform set_config('app.activity_skip', 'on', true);
    perform set_config('app.system_notice', 'on', true);
    insert into public.outgoing_messages
      (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by)
    values
      (v_group.id, v_group.instance_id, v_text, v_text,
       (select id from public.messages where id = new.origin_message_id and group_id = v_group.id),
       coalesce(v_sender, 'Demandas'), auth.uid());
    perform set_config('app.activity_skip', 'off', true);
    perform set_config('app.system_notice', 'off', true);
  exception when others then
    perform set_config('app.activity_skip', 'off', true);
    perform set_config('app.system_notice', 'off', true);
    raise warning 'aviso da demanda % não foi para a fila: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.demands_notify_done()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_on boolean;
  v_group public.groups%rowtype;
  v_text text;
  v_sender text;
begin
  if new.status <> 'entregue' or old.status = 'entregue' then
    return new;
  end if;
  select * into v_group from public.groups where id = new.group_id;
  if v_group.id is null or v_group.removed_at is not null then
    return new;
  end if;
  select coalesce(demand_done_notify, true) into v_on from public.app_settings where company_id = v_group.company_id;
  if not coalesce(v_on, true) then
    return new;
  end if;
  v_text := public.demand_done_notice(new);
  if nullif(btrim(v_text), '') is null then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_sender from public.profiles where id = auth.uid();
  -- o aviso nunca impede a entrega
  begin
    perform set_config('app.activity_skip', 'on', true);
    perform set_config('app.system_notice', 'on', true);
    insert into public.outgoing_messages
      (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by)
    values
      (v_group.id, v_group.instance_id, v_text, v_text,
       (select id from public.messages where id = new.origin_message_id and group_id = v_group.id),
       coalesce(v_sender, 'Demandas'), auth.uid());
    perform set_config('app.activity_skip', 'off', true);
    perform set_config('app.system_notice', 'off', true);
  exception when others then
    perform set_config('app.activity_skip', 'off', true);
    perform set_config('app.system_notice', 'off', true);
    raise warning 'aviso de conclusão da demanda % não foi para a fila: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
