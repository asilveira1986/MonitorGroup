-- =====================================================================
-- Conversas privadas por usuário.
--
--  * As conversas privadas deixam de ser só de quem administra a
--    plataforma: administradores e atendentes da empresa (com o módulo
--    ligado) usam. "Somente ver painéis" e "Só agenda" continuam sem.
--  * Cada conversa tem um responsável (assigned_to):
--    - conversa nova de cliente chega "Sem responsável": todos veem e
--      são avisados;
--    - quem responde primeiro (ou clica em Assumir) fica com ela; quem
--      inicia uma conversa já é o responsável;
--    - o responsável pode transferir ou devolver para "Sem responsável";
--      o administrador pode tudo.
--  * Cada usuário vê as suas conversas e as sem responsável; os
--    administradores veem todas.
--  * Avisos (celular e tela): da conversa sem responsável, para todos;
--    da conversa com responsável, só para ele. Transferir avisa quem
--    recebeu.
-- =====================================================================

alter table public.private_chats
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz;
create index if not exists private_chats_assigned_idx on public.private_chats (company_id, assigned_to);

-- quem usa: administradores e atendentes ativos, na empresa com o módulo ligado
create or replace function public.can_use_private_chats()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and coalesce((select private_chats_enabled from public.companies where id = public.current_company_id()), false)
     and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.platform_admin or p.role in ('admin', 'agent')))
$$;
revoke all on function public.can_use_private_chats() from public, anon;
grant execute on function public.can_use_private_chats() to authenticated;

-- vê as conversas de todos (administradores)
create or replace function public.private_sees_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and public.is_admin()
$$;
revoke all on function public.private_sees_all() from public, anon;
grant execute on function public.private_sees_all() to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to is null or c.assigned_to = auth.uid() or public.private_sees_all()))
$$;
revoke all on function public.private_chat_visible(uuid) from public, anon;
grant execute on function public.private_chat_visible(uuid) to authenticated;

create or replace function public.user_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'outro usuário') from public.profiles where id = p_user
$$;
revoke all on function public.user_display_name(uuid) from public, anon, authenticated;

-- ------------------------------------------------ leitura: as suas, as sem responsável (e todas, para administradores)
drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to is null or assigned_to = (select auth.uid()) or (select public.private_sees_all())));
drop policy if exists private_messages_read on public.private_messages;
create policy private_messages_read on public.private_messages for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and chat_id in (select id from public.private_chats));
drop policy if exists private_outgoing_read on public.private_outgoing;
create policy private_outgoing_read on public.private_outgoing for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and chat_id in (select id from public.private_chats));
drop policy if exists private_reactions_read on public.private_reactions;
create policy private_reactions_read on public.private_reactions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and message_id in (select id from public.private_messages));
drop policy if exists private_actions_read on public.private_actions;
create policy private_actions_read on public.private_actions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and message_id in (select id from public.private_messages));

-- ------------------------------------------------ envio pelo painel: só na conversa que a pessoa vê; sem responsável, assume
create or replace function public.private_outgoing_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return new;                                   -- worker / sistema
  end if;
  if not public.private_chat_visible(new.chat_id) then
    select assigned_to into v_owner from public.private_chats where id = new.chat_id;
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_owner)
      using errcode = '42501';
  end if;
  update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and assigned_to is null;
  return new;
end;
$$;
drop trigger if exists private_outgoing_owner on public.private_outgoing;
create trigger private_outgoing_owner before insert on public.private_outgoing
  for each row execute function public.private_outgoing_owner();

-- editar, apagar e reagir: só na conversa que a pessoa vê
create or replace function public.private_actions_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (
       select 1 from public.private_messages m where m.id = new.message_id and public.private_chat_visible(m.chat_id)) then
    raise exception 'Mensagem não encontrada.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists private_actions_owner on public.private_actions;
create trigger private_actions_owner before insert on public.private_actions
  for each row execute function public.private_actions_owner();

-- ------------------------------------------------ abrir / iniciar conversa
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
  select id into v_instance from public.whatsapp_instances
   where company_id = v_company order by (status = 'connected') desc, created_at limit 1;
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

create or replace function public.mark_private_chat_read(p_chat_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.private_chats set unread_count = 0
   where id = p_chat_id and public.private_chat_visible(p_chat_id);
$$;

create or replace function public.set_private_chat_tags(p_chat uuid, p_tags uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_tags uuid[] := public.clean_customer_tags(p_tags);
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats set tags = v_tags where id = p_chat;
  return v_tags;
end;
$$;
revoke all on function public.set_private_chat_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_private_chat_tags(uuid, uuid[]) to authenticated;

-- ------------------------------------------------ assumir, transferir e devolver
-- p_user: o novo responsável (null = volta para "Sem responsável")
create or replace function public.assign_private_chat(p_chat uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if p_user is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_user and p.company_id = c.company_id and p.active
          and (p.platform_admin or p.role in ('admin', 'agent'))) then
    raise exception 'Escolha um administrador ou atendente ativo da empresa.';
  end if;
  if p_user is not distinct from c.assigned_to then
    return;
  end if;
  update public.private_chats set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end
   where id = p_chat;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user is not null and p_user <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '💬 Conversa transferida para você',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me),
      '/private?c=' || c.id, null, array[p_user], 'private:' || c.id, null);
  end if;
end;
$$;
revoke all on function public.assign_private_chat(uuid, uuid) from public, anon;
grant execute on function public.assign_private_chat(uuid, uuid) to authenticated;

-- quem pode receber uma conversa (para o "Transferir")
create or replace function public.private_chat_agents()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.user_display_name(p.id)) order by lower(public.user_display_name(p.id))), '[]'::jsonb)
    from public.profiles p
   where public.can_use_private_chats() and p.company_id = public.current_company_id() and p.active
     and (p.platform_admin or p.role in ('admin', 'agent'))
$$;
grant execute on function public.private_chat_agents() to authenticated;

-- ------------------------------------------------ aviso no celular: sem responsável, para todos; com responsável, só ele
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
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
  if c.assigned_to is null then
    perform public.queue_push(new.company_id, 'private', 'private', v_title, v_body,
      '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  else
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null, array[c.assigned_to], 'private:' || new.chat_id);
  end if;
  return new;
end;
$$;
