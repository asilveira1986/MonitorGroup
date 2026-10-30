-- =====================================================================
-- Conversas privadas por setor (de novo, depois da 0124).
--
--  * A conversa que aguarda atendimento aparece e avisa só para quem é do
--    setor do número por onde ela chegou (Configurações › WhatsApp ›
--    Setor do número). Número sem setor: todos.
--  * Administradores e quem é do setor padrão ("Geral", 0129) veem todas.
--  * A conversa que já está com o usuário continua com ele, de qualquer
--    setor.
--  * Na tela, só os administradores filtram por setor.
-- =====================================================================

-- o usuário pode ver e atender as conversas que aguardam neste número?
create or replace function public.private_instance_ok(p_instance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.in_general_sector() or coalesce((
    select i.sector_id is null
        or exists (select 1 from public.sector_members m where m.sector_id = i.sector_id and m.user_id = auth.uid())
      from public.whatsapp_instances i where i.id = p_instance), true)
$$;
revoke all on function public.private_instance_ok(uuid) from public, anon;
grant execute on function public.private_instance_ok(uuid) to authenticated;

-- aviso no celular: a que aguarda num número com setor vai para o setor (e o setor padrão e os
-- administradores); sem setor, para todos; a assumida, para o responsável
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_sector uuid;
  v_general uuid;
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
  v_general := public.general_sector_id(new.company_id);
  if c.assigned_to is null and v_sector is not null then
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null,
      array(select distinct p.id from public.profiles p
             where p.company_id = new.company_id and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
               and (p.role = 'admin' or p.platform_admin
                    or exists (select 1 from public.sector_members m
                                where m.user_id = p.id and (m.sector_id = v_sector or m.sector_id = v_general)))),
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
