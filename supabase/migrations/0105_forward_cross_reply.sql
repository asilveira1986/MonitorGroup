-- =====================================================================
-- Encaminhar mensagens e responder de uma conversa na outra.
--
--  * Encaminhar: uma mensagem do grupo ou do privado vai para uma
--    conversa privada ou para um grupo (texto, imagem, vídeo, áudio ou
--    documento guardado), marcada como "Encaminhada" no WhatsApp.
--  * Responder no privado: a mensagem de alguém no grupo é respondida na
--    conversa privada com essa pessoa, citando a mensagem do grupo (como o
--    "Responder em particular" do WhatsApp).
--  * Responder no grupo: a mensagem do privado é respondida num grupo,
--    citando a mensagem da conversa privada.
--  * As conversas privadas seguem só para quem pode usá-las; os grupos,
--    com as mesmas regras de "Responder pelo sistema".
-- =====================================================================

alter table public.outgoing_messages
  add column if not exists forwarded boolean not null default false,
  add column if not exists media_name text,
  add column if not exists quoted_private_message_id uuid references public.private_messages(id) on delete set null;
alter table public.private_outgoing
  add column if not exists forwarded boolean not null default false,
  add column if not exists quoted_group_message_id uuid references public.messages(id) on delete set null;
-- citação de outra conversa (texto e de onde veio) e "Encaminhada", para mostrar no painel
alter table public.private_messages
  add column if not exists forwarded boolean not null default false,
  add column if not exists quoted_body text,
  add column if not exists quoted_from text;
alter table public.messages add column if not exists forwarded boolean not null default false;

-- pode mandar no grupo pelo painel? (as regras de send_group_message)
create or replace function public.group_send_check(p_group uuid)
returns public.groups language plpgsql stable security definer set search_path = public as $$
declare
  v_settings public.app_settings%rowtype;
  v_group public.groups%rowtype;
begin
  if not public.is_active_user() or not public.can_write() then
    raise exception 'Seu perfil não envia mensagens.' using errcode = '42501';
  end if;
  select * into v_group from public.groups where id = p_group and company_id = public.current_company_id();
  if not found or not (p_group = any(public.visible_group_ids())) then
    raise exception 'Grupo não encontrado.';
  end if;
  select * into v_settings from public.app_settings where company_id = v_group.company_id;
  if not v_settings.reply_enabled then
    raise exception 'Responder pelo sistema está desligado. Um administrador pode ativar em Configurações › Geral.';
  end if;
  if v_settings.reply_allowed = 'admin' and not public.is_admin() then
    raise exception 'Só administradores podem responder pelo sistema.' using errcode = '42501';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  if not v_group.monitored then
    raise exception 'Ative o monitoramento do grupo para enviar por aqui.';
  end if;
  return v_group;
end;
$$;
revoke all on function public.group_send_check(uuid) from public, anon, authenticated;

create or replace function public.private_send_check(p_chat uuid)
returns public.private_chats language plpgsql stable security definer set search_path = public as $$
declare
  v_chat public.private_chats%rowtype;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  select * into v_chat from public.private_chats where id = p_chat and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  return v_chat;
end;
$$;
revoke all on function public.private_send_check(uuid) from public, anon, authenticated;

create or replace function public.my_display_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) from public.profiles where id = auth.uid()
$$;
revoke all on function public.my_display_name() from public, anon, authenticated;

-- ------------------------------------------------ encaminhar
-- p_kind: 'group' (mensagem de grupo) ou 'private'; p_target_kind: 'group' ou 'private'
create or replace function public.forward_message(p_kind text, p_message uuid, p_target_kind text, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_body text;
  v_path text;
  v_mime text;
  v_size bigint;
  v_name text;
  v_seconds int;
  v_group public.groups%rowtype;
  v_chat public.private_chats%rowtype;
  v_id uuid;
begin
  -- a mensagem de origem (quem vê a conversa de origem)
  if p_kind = 'group' then
    select m.message_type, m.body, m.media_path, m.media_mime, m.media_size
      into v_type, v_body, v_path, v_mime, v_size
      from public.messages m
     where m.id = p_message and m.group_id = any(public.visible_group_ids()) and m.deleted_at is null;
  elsif p_kind = 'private' and public.can_use_private_chats() then
    select m.message_type, m.body, m.media_path, m.media_mime, m.media_size
      into v_type, v_body, v_path, v_mime, v_size
      from public.private_messages m
     where m.id = p_message and m.company_id = public.current_company_id() and m.deleted_at is null;
  end if;
  if v_type is null then
    raise exception 'Mensagem não encontrada.';
  end if;
  v_type := case when v_type in ('image', 'video', 'audio', 'document') then v_type
                 when v_type = 'sticker' then 'image' else 'text' end;
  if v_type <> 'text' and v_path is null then
    raise exception 'O arquivo desta mensagem não está guardado no sistema: não dá para encaminhar.';
  end if;
  if v_type = 'text' and nullif(btrim(coalesce(v_body, '')), '') is null then
    raise exception 'Esta mensagem não tem texto para encaminhar.';
  end if;
  if v_type = 'document' then
    v_name := coalesce(nullif(btrim(v_body), ''), 'arquivo');
    v_body := null;
  end if;

  if p_target_kind = 'group' then
    v_group := public.group_send_check(p_target);
    insert into public.outgoing_messages
      (group_id, instance_id, body, text_to_send, sender_name, created_by, message_type, media_path, media_mime, media_size,
       media_name, forwarded)
    values
      (v_group.id, v_group.instance_id, coalesce(v_body, ''), coalesce(v_body, ''), public.my_display_name(), auth.uid(),
       v_type, v_path, v_mime, v_size, v_name, true)
    returning id into v_id;
  elsif p_target_kind = 'private' then
    v_chat := public.private_send_check(p_target);
    insert into public.private_outgoing
      (chat_id, company_id, instance_id, body, created_by, message_type, media_path, media_mime, media_name, media_size, forwarded)
    values
      (v_chat.id, v_chat.company_id, v_chat.instance_id, case when v_type = 'audio' then null else v_body end, auth.uid(),
       v_type, v_path, v_mime, v_name, v_size, true)
    returning id into v_id;
  else
    raise exception 'Escolha para onde encaminhar.';
  end if;
  return jsonb_build_object('kind', p_target_kind, 'target', p_target, 'outgoing', v_id);
end;
$$;
revoke all on function public.forward_message(text, uuid, text, uuid) from public, anon;
grant execute on function public.forward_message(text, uuid, text, uuid) to authenticated;

-- ------------------------------------------------ responder no privado (mensagem de um grupo)
create or replace function public.reply_privately(p_message uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_chat public.private_chats;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  select * into m from public.messages where id = p_message and group_id = any(public.visible_group_ids());
  if m.id is null then
    raise exception 'Mensagem não encontrada.';
  end if;
  if m.from_me or m.sender_jid is null then
    raise exception 'Só dá para responder no privado a mensagem de outra pessoa.';
  end if;
  if v_body is null then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  -- a conversa com quem escreveu (pelo telefone, quando se sabe; senão pelo identificador do WhatsApp)
  v_chat := case when nullif(m.sender_phone, '') is not null
                 then public.start_private_chat(null, m.sender_phone, m.sender_name)
                 else public.start_private_chat(m.sender_jid, null, m.sender_name) end;
  insert into public.private_outgoing (chat_id, company_id, instance_id, body, created_by, message_type, quoted_group_message_id)
  values (v_chat.id, v_chat.company_id, v_chat.instance_id, v_body, auth.uid(), 'text', m.id);
  return v_chat.id;
end;
$$;
revoke all on function public.reply_privately(uuid, text) from public, anon;
grant execute on function public.reply_privately(uuid, text) to authenticated;

-- ------------------------------------------------ responder no grupo (mensagem do privado)
create or replace function public.reply_in_group(p_message uuid, p_group uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_group public.groups%rowtype;
  v_settings public.app_settings%rowtype;
  v_name text := public.my_display_name();
begin
  if not public.can_use_private_chats()
     or not exists (select 1 from public.private_messages where id = p_message and company_id = public.current_company_id()) then
    raise exception 'Mensagem não encontrada.';
  end if;
  if v_body is null then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  v_group := public.group_send_check(p_group);
  select * into v_settings from public.app_settings where company_id = v_group.company_id;
  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, sender_name, created_by, message_type, quoted_private_message_id)
  values
    (v_group.id, v_group.instance_id, v_body,
     case when v_settings.reply_sign_name then '*' || v_name || ':*' || E'\n' || v_body else v_body end,
     v_name, auth.uid(), 'text', p_message);
  return v_group.id;
end;
$$;
revoke all on function public.reply_in_group(uuid, uuid, text) from public, anon;
grant execute on function public.reply_in_group(uuid, uuid, text) to authenticated;
