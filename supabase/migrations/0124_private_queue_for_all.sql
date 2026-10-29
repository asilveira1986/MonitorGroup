-- =====================================================================
-- Conversas privadas aguardando atendimento: para todos os usuários.
--
--  * A conversa que aguarda (sem responsável) aparece e avisa para todos
--    que usam o privado, qualquer que seja o setor do número (0121).
--  * Depois que alguém assume, continua só com o responsável (e os
--    administradores), como antes.
--  * O setor do número segue valendo para o filtro da tela, para o número
--    usado ao iniciar conversa e para os grupos.
-- =====================================================================

-- usada nas regras de acesso (0121): a que aguarda é de todos
create or replace function public.private_instance_ok(p_instance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select true
$$;
revoke all on function public.private_instance_ok(uuid) from public, anon;
grant execute on function public.private_instance_ok(uuid) to authenticated;

-- aviso no celular: a que aguarda vai para todos do privado; a assumida, para o responsável
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
