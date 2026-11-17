-- =====================================================================
-- Enviar um contato (cartão do WhatsApp) pela conversa, no grupo e no privado.
--
--  * contact_vcard(nome, telefone): o cartão (vCard) que o WhatsApp abre como
--    contato, com o link para conversar.
--  * send_group_contact / send_private_contact: entram na fila de envio
--    (message_type = 'contact'; o worker monta o cartão). Mesmas regras de
--    quem pode responder pelo sistema que as mensagens de texto.
-- =====================================================================

create or replace function public.contact_vcard(p_name text, p_phone text)
returns text language sql immutable as $$
  select 'BEGIN:VCARD' || E'\n' || 'VERSION:3.0' || E'\n' || 'N:;' || x.n || ';;;' || E'\n' || 'FN:' || x.n || E'\n' ||
         'TEL;type=CELL;type=VOICE;waid=' || x.d || ':+' || x.d || E'\n' || 'END:VCARD'
    from (select btrim(regexp_replace(replace(replace(coalesce(p_name, ''), ';', ' '), ',', ' '), '[[:space:]]+', ' ', 'g')) as n,
                 -- com "+" o número já traz o país; sem ele, DDD + número (10 ou 11 dígitos) é do Brasil
                 case when btrim(coalesce(p_phone, '')) not like '+%' and length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) in (10, 11)
                      then '55' || regexp_replace(p_phone, '[^0-9]', '', 'g')
                      else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') end as d) x
$$;

-- nome e telefone válidos (o telefone com DDD; fora do Brasil, com o código do país)
create or replace function public.contact_card_check(p_name text, p_phone text)
returns void language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Informe o nome do contato.';
  end if;
  if length(btrim(p_name)) > 100 then
    raise exception 'O nome do contato passa de 100 caracteres.';
  end if;
  if btrim(coalesce(p_phone, '')) not like '+%' and length(d) between 10 and 11 then
    d := '55' || d;
  end if;
  if length(d) < 12 or length(d) > 15 then
    raise exception 'Informe o telefone com DDD (e o código do país, se não for do Brasil).';
  end if;
end;
$$;

-- grupo
create or replace function public.send_group_contact(p_group_id uuid, p_name text, p_phone text, p_quoted_message_id uuid default null)
returns public.outgoing_messages
language plpgsql security definer set search_path = public as $$
declare
  v_settings public.app_settings%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_row      public.outgoing_messages;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.contact_card_check(p_name, p_phone);
  select * into v_group from public.groups where id = p_group_id and company_id = public.current_company_id();
  if not found then
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
    raise exception 'Ative o monitoramento do grupo para responder por aqui.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.messages where id = p_quoted_message_id and group_id = p_group_id) then
    raise exception 'Mensagem citada não pertence a este grupo.';
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name from public.profiles where id = auth.uid();

  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by, message_type, media_name)
  values
    (p_group_id, v_group.instance_id, btrim(p_name), public.contact_vcard(p_name, p_phone), p_quoted_message_id, v_name, auth.uid(),
     'contact', left(btrim(p_name), 200))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_group_contact(uuid, text, text, uuid) from public, anon;
grant execute on function public.send_group_contact(uuid, text, text, uuid) to authenticated;

-- privado
create or replace function public.send_private_contact(p_chat_id uuid, p_name text, p_phone text)
returns public.private_outgoing
language plpgsql security definer set search_path = public as $$
declare
  v_chat public.private_chats%rowtype;
  v_row  public.private_outgoing;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  perform public.contact_card_check(p_name, p_phone);
  select * into v_chat from public.private_chats where id = p_chat_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  insert into public.private_outgoing (chat_id, company_id, instance_id, body, text_to_send, created_by, message_type, media_name)
  values (v_chat.id, v_chat.company_id, v_chat.instance_id, btrim(p_name), public.contact_vcard(p_name, p_phone), auth.uid(), 'contact', left(btrim(p_name), 200))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_private_contact(uuid, text, text) from public, anon;
grant execute on function public.send_private_contact(uuid, text, text) to authenticated;
