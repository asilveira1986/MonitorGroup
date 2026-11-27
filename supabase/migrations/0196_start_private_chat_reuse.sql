-- =====================================================================
-- "Nova conversa" não abre mais uma conversa vazia quando a pessoa já tem conversa (Conversas privadas).
--
-- Antes, start_private_chat só reaproveitava a conversa com o mesmo número conectado E o mesmo identificador (jid). Se o histórico
-- estava sob outro identificador (o novo @lid do WhatsApp, em vez do telefone) ou em outro número conectado, criava uma conversa
-- nova, vazia, duplicando o contato. Agora procura primeiro a conversa da mesma pessoa (pelo telefone, sem o 9 do celular, ou pelo
-- identificador): a do mesmo número conectado; senão a de outro número que já tenha mensagens. As duplicadas que já existem não
-- são mescladas.
-- =====================================================================

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

  -- a pessoa já tem conversa com a empresa (0196)? Reaproveita em vez de abrir outra vazia: a do mesmo número conectado, com o
  -- telefone ou o identificador @lid; senão a de outro número conectado que já tenha mensagens (o histórico fica onde está).
  -- O telefone compara sem o 9 do celular. Uma conversa de outro número SEM mensagens não conta: começa uma nova neste.
  select c.* into v_row from public.private_chats c
   where c.company_id = v_company
     and (c.jid = v_jid or public.phone_key(c.phone) = public.phone_key(v_phone))
     and (c.instance_id = v_instance or c.last_message_at is not null)
   order by (c.instance_id = v_instance) desc, (c.closed_at is null) desc, c.last_message_at desc nulls last, c.created_at
   limit 1;
  if v_row.id is not null then
    update public.private_chats
       set name = coalesce(name, nullif(btrim(p_name), ''), v_contact.name, v_contact.notify),
           phone = coalesce(phone, v_phone)
     where id = v_row.id
     returning * into v_row;
  else
    insert into public.private_chats (instance_id, company_id, jid, phone, name)
    values (v_instance, v_company, v_jid, v_phone,
            coalesce(nullif(btrim(p_name), ''), v_contact.name, v_contact.notify))
    on conflict (instance_id, jid) do update
      set name = coalesce(public.private_chats.name, excluded.name),
          phone = coalesce(public.private_chats.phone, excluded.phone)
    returning * into v_row;
  end if;
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

notify pgrst, 'reload schema';
