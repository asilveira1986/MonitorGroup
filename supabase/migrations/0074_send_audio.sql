-- =====================================================================
-- Enviar áudio (mensagem de voz) pelo painel, nos grupos e no privado.
--
--  * O painel grava pelo microfone (ou anexa um arquivo de áudio) e sobe
--    para o Storage (media/<empresa>/<grupo>/... ou .../private/...).
--  * O worker converte para o formato de voz do WhatsApp (OGG/Opus) e
--    envia como mensagem de voz (voice = true) pelo número conectado.
-- =====================================================================

alter table public.outgoing_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_size bigint,
  add column if not exists voice boolean not null default false;

alter table public.private_outgoing
  add column if not exists voice boolean not null default false;

-- grupo: texto, ou áudio (p_media = {path, mime, size, voice}); o áudio não leva assinatura
drop function if exists public.send_group_message(uuid, text, uuid, boolean);
create or replace function public.send_group_message(
  p_group_id uuid, p_body text, p_quoted_message_id uuid default null, p_closes boolean default false, p_media jsonb default null
)
returns public.outgoing_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.app_settings%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_path     text;
  v_row      public.outgoing_messages;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_settings from public.app_settings
   where company_id = (select company_id from public.groups where id = p_group_id);
  if not v_settings.reply_enabled then
    raise exception 'Responder pelo sistema está desligado. Um administrador pode ativar em Configurações › Geral.';
  end if;
  if v_settings.reply_allowed = 'admin' and not public.is_admin() then
    raise exception 'Só administradores podem responder pelo sistema.' using errcode = '42501';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;
  if p_media is not null then
    v_path := p_media->>'path';
    -- o áudio precisa estar na pasta deste grupo
    if v_path is null or v_path not like v_group.company_id::text || '/' || v_group.id::text || '/%' then
      raise exception 'Arquivo inválido.';
    end if;
    if coalesce(p_media->>'mime', '') not like 'audio/%' then
      raise exception 'Só dá para enviar áudio nos grupos.';
    end if;
    if coalesce((p_media->>'size')::bigint, 0) > 16 * 1024 * 1024 then
      raise exception 'O áudio passa de 16 MB.';
    end if;
    v_body := '';
  elsif v_body = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  if not v_group.monitored then
    raise exception 'Ative o monitoramento do grupo para responder por aqui.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.messages where id = p_quoted_message_id and group_id = p_group_id) then
    raise exception 'Mensagem citada não pertence a este grupo.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name
  from public.profiles where id = auth.uid();

  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by, closes_conversation,
     message_type, media_path, media_mime, media_size, voice)
  values
    (p_group_id, v_group.instance_id, v_body,
     case when v_path is not null then ''
          when v_settings.reply_sign_name then '*' || v_name || ':*' || E'\n' || v_body
          else v_body end,
     p_quoted_message_id, v_name, auth.uid(), coalesce(p_closes, false),
     case when v_path is not null then 'audio' else 'text' end, v_path, p_media->>'mime', (p_media->>'size')::bigint,
     coalesce((p_media->>'voice')::boolean, false))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_group_message(uuid, text, uuid, boolean, jsonb) from public, anon;
grant execute on function public.send_group_message(uuid, text, uuid, boolean, jsonb) to authenticated;

-- privado: o mesmo envio de arquivo (0071), agora com voice = true para a mensagem de voz gravada
create or replace function public.send_private_message(
  p_chat_id uuid, p_body text default null, p_quoted_message_id uuid default null, p_media jsonb default null
)
returns public.private_outgoing
language plpgsql security definer set search_path = public
as $$
declare
  v_chat public.private_chats%rowtype;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_type text := 'text';
  v_path text;
  v_row  public.private_outgoing;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  select * into v_chat from public.private_chats where id = p_chat_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  if p_media is not null then
    v_path := p_media->>'path';
    v_type := coalesce(p_media->>'type', 'document');
    if v_type not in ('image', 'video', 'audio', 'document') then
      raise exception 'Tipo de arquivo inválido.';
    end if;
    -- o arquivo precisa estar na pasta desta conversa
    if v_path is null or v_path not like v_chat.company_id::text || '/private/' || v_chat.id::text || '/%' then
      raise exception 'Arquivo inválido.';
    end if;
    if coalesce((p_media->>'size')::bigint, 0) > 50 * 1024 * 1024 then
      raise exception 'O arquivo passa de 50 MB.';
    end if;
  elsif v_body is null then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(coalesce(v_body, '')) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.private_messages where id = p_quoted_message_id and chat_id = v_chat.id) then
    raise exception 'A mensagem citada não é desta conversa.';
  end if;

  insert into public.private_outgoing
    (chat_id, company_id, instance_id, body, created_by, message_type, media_path, media_mime, media_name, media_size,
     quoted_message_id, voice)
  values
    (v_chat.id, v_chat.company_id, v_chat.instance_id, case when v_type = 'audio' then null else v_body end, auth.uid(),
     v_type, v_path, p_media->>'mime', left(p_media->>'name', 200), (p_media->>'size')::bigint, p_quoted_message_id,
     v_type = 'audio' and coalesce((p_media->>'voice')::boolean, false))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_private_message(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.send_private_message(uuid, text, uuid, jsonb) to authenticated;
