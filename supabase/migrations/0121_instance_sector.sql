-- =====================================================================
-- Setor do número de WhatsApp conectado.
--
--  * Cada número conectado pode ter um setor (Configurações › WhatsApp).
--  * Conversas privadas que chegam por um número com setor: as que
--    aguardam atendimento só aparecem (e só avisam) para quem é do setor;
--    quem não é do setor só vê a conversa se ela for transferida para ele.
--    Administradores veem todas. Número sem setor: como antes (todos).
--  * Na tela de conversas privadas, filtro por setor.
--  * Iniciar conversa: usa o número do setor do usuário.
-- =====================================================================

alter table public.whatsapp_instances
  add column if not exists sector_id uuid references public.sectors(id) on delete set null;

-- o usuário pode atender as conversas que aguardam neste número? (sem setor: todos; com setor: quem é do setor)
create or replace function public.private_instance_ok(p_instance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select i.sector_id is null
        or exists (select 1 from public.sector_members m where m.sector_id = i.sector_id and m.user_id = auth.uid())
      from public.whatsapp_instances i where i.id = p_instance), true)
$$;
revoke all on function public.private_instance_ok(uuid) from public, anon;
grant execute on function public.private_instance_ok(uuid) to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to = auth.uid() or public.private_sees_all()
            or (c.assigned_to is null and public.private_instance_ok(c.instance_id))))
$$;

drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to = (select auth.uid()) or (select public.private_sees_all())
              or (assigned_to is null and public.private_instance_ok(instance_id))));

-- setor de um número (administradores)
create or replace function public.set_instance_sector(p_instance uuid, p_sector uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Só administradores mudam o setor do número.' using errcode = '42501';
  end if;
  if p_sector is not null and not exists (select 1 from public.sectors where id = p_sector and company_id = public.current_company_id()) then
    raise exception 'Setor não encontrado.';
  end if;
  update public.whatsapp_instances set sector_id = p_sector where id = p_instance and company_id = public.current_company_id();
  if not found then
    raise exception 'Conexão não encontrada.';
  end if;
end;
$$;
revoke all on function public.set_instance_sector(uuid, uuid) from public, anon;
grant execute on function public.set_instance_sector(uuid, uuid) to authenticated;

-- iniciar conversa: pelo número do setor do usuário
create or replace function public.start_private_chat(p_jid text default null, p_phone text default null, p_name text default null)
returns public.private_chats language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_instance uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_jid text := nullif(btrim(coalesce(p_jid, '')), '');
  v_contact public.wa_contacts%rowtype;
  v_row public.private_chats;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  -- o número do setor do usuário (0121), mesmo desconectado (a mensagem sai quando ele voltar, e não
  -- por outro número); depois um sem setor; conectado antes de desconectado
  select i.id into v_instance from public.whatsapp_instances i
   where i.company_id = v_company
   order by (i.sector_id is not null and exists (select 1 from public.sector_members m
                                                  where m.sector_id = i.sector_id and m.user_id = auth.uid())) desc,
            (i.sector_id is null) desc, (i.status = 'connected') desc, i.created_at
   limit 1;
  if v_instance is null then
    raise exception 'Conecte um WhatsApp em Configurações › WhatsApp.';
  end if;
  if v_jid is null then
    if length(v_phone) between 10 and 11 then
      v_phone := '55' || v_phone;              -- DDD + número: Brasil
    end if;
    if length(v_phone) < 12 or length(v_phone) > 15 then
      raise exception 'Informe o número com DDD (e o código do país, se não for do Brasil).';
    end if;
    v_jid := v_phone || '@s.whatsapp.net';
    -- número digitado: o nome salvo na agenda (com ou sem o 9 do celular)
    select * into v_contact from public.wa_contacts
     where instance_id = v_instance and public.phone_key(phone) = public.phone_key(v_phone)
     order by (name is not null) desc limit 1;
  else
    select * into v_contact from public.wa_contacts where instance_id = v_instance and jid = v_jid;
    if v_contact.name is null and v_contact.phone is not null then
      select coalesce(v_contact.name, w.name) into v_contact.name from public.wa_contacts w
       where w.instance_id = v_instance and w.name is not null and public.phone_key(w.phone) = public.phone_key(v_contact.phone)
       limit 1;
    end if;
    v_phone := coalesce(v_contact.phone, nullif(split_part(v_jid, '@', 1), ''));
    if v_jid like '%@lid' and v_contact.phone is null then
      v_phone := null;
    end if;
  end if;

  insert into public.private_chats (instance_id, company_id, jid, phone, name)
  values (v_instance, v_company, v_jid, v_phone,
          coalesce(nullif(btrim(p_name), ''), v_contact.name, v_contact.notify))
  on conflict (instance_id, jid) do update
    set name = coalesce(public.private_chats.name, excluded.name),
        phone = coalesce(public.private_chats.phone, excluded.phone)
  returning * into v_row;
  -- quem inicia a conversa fica com ela; a de outro usuário só o administrador abre
  if v_row.assigned_to is null then
    update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
     where id = v_row.id returning * into v_row;
  elsif v_row.assigned_to <> auth.uid() and not public.private_sees_all() then
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_row.assigned_to);
  end if;
  return v_row;
end;
$$
;
revoke all on function public.start_private_chat(text, text, text) from public, anon;
grant execute on function public.start_private_chat(text, text, text) to authenticated;

-- aviso no celular da conversa que aguarda num número com setor: só para o setor
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_sector uuid;
  v_title text;
  v_body text;
begin
  if new.from_me or new.sent_at < now() - interval '10 minutes' then
    return new;
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not coalesce((select private_chats_enabled from public.companies where id = new.company_id), false) then
    return new;
  end if;
  v_title := '💬 ' || coalesce(nullif(btrim(c.name), ''), nullif(btrim(new.sender_name), ''), c.phone, 'Conversa privada');
  v_body := case new.message_type when 'text' then left(coalesce(new.body, ''), 160)
                                  when 'audio' then '🎤 Áudio' when 'image' then '📷 Imagem'
                                  when 'document' then '📄 Documento' when 'video' then '🎬 Vídeo'
                                  else coalesce(left(new.body, 160), 'Nova mensagem') end;
  select sector_id into v_sector from public.whatsapp_instances where id = c.instance_id;
  if c.assigned_to is null and v_sector is not null then
    -- número com setor (0121): só quem é do setor e usa o privado
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null,
      array(select p.id from public.sector_members m join public.profiles p on p.id = m.user_id
             where m.sector_id = v_sector and p.active and (p.platform_admin or p.role in ('admin', 'agent'))),
      'private:' || new.chat_id);
  elsif c.assigned_to is null then
    perform public.queue_push(new.company_id, 'private', 'private', v_title, v_body,
      '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  else
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null, array[c.assigned_to], 'private:' || new.chat_id);
  end if;
  return new;
end;
$$;
