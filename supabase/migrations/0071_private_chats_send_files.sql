-- =====================================================================
-- Conversas privadas, fase 3: enviar arquivos e responder citando.
--
--  * O painel envia imagem, vídeo, áudio ou documento (até 50 MB), com
--    legenda: o arquivo vai para o Storage (media/<empresa>/private/...)
--    e o worker manda pelo número conectado.
--  * Responder citando uma mensagem (como no WhatsApp); as respostas com
--    citação recebidas também mostram a mensagem citada.
-- =====================================================================

alter table public.private_messages
  add column if not exists quoted_message_id uuid references public.private_messages(id) on delete set null;

alter table public.private_outgoing
  add column if not exists message_type text not null default 'text',
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_name text,
  add column if not exists media_size bigint,
  add column if not exists quoted_message_id uuid references public.private_messages(id) on delete set null;
alter table public.private_outgoing alter column body drop not null;

drop function if exists public.send_private_message(uuid, text);

-- envia pelo número conectado: texto, ou arquivo (p_media) com legenda, citando ou não uma mensagem
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
    (chat_id, company_id, instance_id, body, created_by, message_type, media_path, media_mime, media_name, media_size, quoted_message_id)
  values
    (v_chat.id, v_chat.company_id, v_chat.instance_id, v_body, auth.uid(), v_type, v_path,
     p_media->>'mime', left(p_media->>'name', 200), (p_media->>'size')::bigint, p_quoted_message_id)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_private_message(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.send_private_message(uuid, text, uuid, jsonb) to authenticated;
