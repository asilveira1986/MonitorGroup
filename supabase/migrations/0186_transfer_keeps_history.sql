-- =====================================================================
-- Transferir a conversa privada para alguém de outro setor: mantém o histórico e vira uma conversa só.
--
-- Antes, a conversa ficava no número do setor de origem e quem recebia (de outro setor) atendia por esse número, enquanto
-- o mesmo contato podia ter outra conversa no número do setor dele. Agora, ao transferir para um usuário de outro setor
-- (que tem número conectado próprio), a conversa passa para o número desse setor com todo o histórico; se o contato já
-- tinha conversa nesse número, as duas são unidas em uma só (merge_private_chats, 0179). O evento "transferiu" registra
-- o motivo e a mudança de número. Administradores e quem não tem setor continuam recebendo no mesmo número.
-- =====================================================================

-- une duas conversas do mesmo contato; com p_cross, de números conectados diferentes (transferência para outro setor)
drop function if exists public.merge_private_chats(uuid, uuid);
create or replace function public.merge_private_chats(p_keep uuid, p_drop uuid, p_cross boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k public.private_chats%rowtype;
  d public.private_chats%rowtype;
  v_last record;
begin
  if p_keep = p_drop then return; end if;
  select * into k from public.private_chats where id = p_keep for update;
  select * into d from public.private_chats where id = p_drop for update;
  if k.id is null or d.id is null or (k.instance_id <> d.instance_id and not p_cross) then
    raise exception 'As conversas precisam existir e ser do mesmo número conectado.';
  end if;

  -- a mesma mensagem nas duas: fica a da conversa mantida
  delete from public.private_messages m
   where m.chat_id = d.id
     and exists (select 1 from public.private_messages x where x.chat_id = k.id and x.wa_message_id = m.wa_message_id);
  update public.private_messages set chat_id = k.id where chat_id = d.id;
  update public.private_reactions set chat_id = k.id where chat_id = d.id;
  update public.private_outgoing set chat_id = k.id where chat_id = d.id;
  update public.private_actions set chat_id = k.id where chat_id = d.id;
  if to_regclass('public.private_chat_events') is not null then
    execute 'update public.private_chat_events set chat_id = $1 where chat_id = $2' using k.id, d.id;
  end if;
  if to_regclass('public.private_history_requests') is not null then
    execute 'delete from public.private_history_requests where chat_id = $1' using d.id;
  end if;

  select sent_at, body, message_type into v_last
    from public.private_messages where chat_id = k.id and hidden_at is null order by sent_at desc limit 1;

  update public.private_chats set
      phone = coalesce(k.phone, d.phone),
      name = coalesce(k.name, d.name),
      tags = coalesce(array(select distinct t from unnest(coalesce(k.tags, '{}') || coalesce(d.tags, '{}')) t), '{}'),
      assigned_to = coalesce(k.assigned_to, d.assigned_to),
      assigned_at = case when k.assigned_to is not null then k.assigned_at else d.assigned_at end,
      unread_count = k.unread_count + d.unread_count,
      -- aberta se alguma das duas estava aberta
      closed_at = case when k.closed_at is null or d.closed_at is null then null else greatest(k.closed_at, d.closed_at) end,
      closed_by = case when k.closed_at is null or d.closed_at is null then null else coalesce(k.closed_by, d.closed_by) end,
      last_message_at = coalesce(v_last.sent_at, greatest(k.last_message_at, d.last_message_at)),
      last_message_preview = case when v_last.sent_at is null then coalesce(k.last_message_preview, d.last_message_preview)
        else left(coalesce(v_last.body, '[' || v_last.message_type || ']'), 140) end
    where id = k.id;
  delete from public.private_chats where id = d.id;
end;
$$;
revoke all on function public.merge_private_chats(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.merge_private_chats(uuid, uuid, boolean) to service_role;

create or replace function public.assign_private_chat(p_chat uuid, p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_chat uuid := p_chat;
  v_cur_sector uuid;
  v_target uuid;
  v_target_name text;
  v_existing uuid;
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  -- devolver para "Aguardando" é o "Liberar", dos administradores
  if p_user is null then
    if c.assigned_to is null and c.closed_at is null then
      return;
    end if;
    perform public.release_private_chat(p_chat, v_note);
    return;
  end if;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.profiles p
        where p.id = p_user and p.company_id = c.company_id and p.active
          and (p.platform_admin or p.role in ('admin', 'agent'))) then
    raise exception 'Escolha um administrador ou atendente ativo da empresa.';
  end if;
  if p_user is not distinct from c.assigned_to and c.closed_at is null then
    return;
  end if;
  -- Quem recebe é de outro setor (a conversa está no número de um setor do qual ele não faz parte) e o setor dele tem
  -- número próprio: a conversa passa para esse número, com todo o histórico. Se o contato já tinha conversa nesse número,
  -- as duas viram uma só (mensagens das duas em ordem). Administradores e quem não tem setor não mudam o número.
  select i.sector_id into v_cur_sector from public.whatsapp_instances i where i.id = c.instance_id;
  if v_cur_sector is not null
     and not exists (select 1 from public.sector_members m where m.user_id = p_user and m.sector_id = v_cur_sector)
     and not exists (select 1 from public.profiles p where p.id = p_user and (p.platform_admin or p.role = 'admin')) then
    select i.id, i.name into v_target, v_target_name
      from public.whatsapp_instances i
      join public.sector_members m on m.sector_id = i.sector_id and m.user_id = p_user
     where i.company_id = c.company_id and i.id <> c.instance_id
     order by (i.status = 'connected') desc, i.created_at
     limit 1;
    if v_target is not null then
      select x.id into v_existing from public.private_chats x
       where x.instance_id = v_target and x.id <> c.id
         and (x.jid = c.jid or (x.phone is not null and c.phone is not null and public.private_phone_key(x.phone) = public.private_phone_key(c.phone)))
       limit 1;
      if v_existing is not null then
        perform public.merge_private_chats(v_existing, c.id, true);
        v_chat := v_existing;
      else
        update public.private_chats set instance_id = v_target where id = c.id;
      end if;
      -- respostas na fila saem pelo número novo
      update public.private_outgoing set instance_id = v_target where chat_id = v_chat and status = 'pending';
      v_note := coalesce(v_note || E'\n', '') || 'A conversa passou para o número ' || coalesce(v_target_name, 'do setor') || ', com o histórico.';
    end if;
  end if;
  -- transferir uma conversa finalizada reabre o atendimento com quem recebeu
  update public.private_chats
     set assigned_to = p_user, assigned_at = now(), closed_at = null, closed_by = null
   where id = v_chat;
  if c.assigned_to is null and p_user = v_me then
    perform public.log_private_chat_event(v_chat, 'assigned', null, p_user, v_note);
  else
    perform public.log_private_chat_event(v_chat, 'transferred', c.assigned_to, p_user, v_note);
  end if;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '💬 Conversa transferida para você',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me)
        || coalesce(E'\n' || left(v_note, 160), ''),
      '/private?c=' || v_chat, null, array[p_user], 'private:' || v_chat, null);
  end if;
end;
$$;
revoke all on function public.assign_private_chat(uuid, uuid, text) from public, anon;
grant execute on function public.assign_private_chat(uuid, uuid, text) to authenticated;
