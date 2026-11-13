-- =====================================================================
-- Conversas privadas: uma conversa por pessoa (telefone), não por identificador.
--
-- O WhatsApp identifica a mesma pessoa ora pelo telefone, ora pelo identificador interno
-- (LID). Como a conversa era única por (número conectado, identificador), as mensagens
-- enviadas pelo telefone e as recebidas pelo LID caíam em conversas diferentes e parte do
-- histórico "sumia" (ficava na outra conversa).
--
--  * private_phone_key(telefone): só os dígitos; telefone brasileiro com o 9 extra
--    (55 DDD 9 xxxx-xxxx) vira a forma sem ele, para "5551999786555" e "555199786555"
--    serem a mesma pessoa.
--  * ingest_private_message: se não há conversa com este identificador mas já existe uma do
--    mesmo número conectado e do mesmo telefone, a mensagem entra nela (em vez de abrir outra).
--  * merge_private_chats(mantém, descarta): passa mensagens, respostas na fila, reações, ações,
--    histórico do atendimento e pedidos de recuperação para a conversa mantida e apaga a outra.
--    Soma as não lidas, junta etiquetas, mantém o responsável e reabre se alguma estava aberta.
--  * merge_duplicate_private_chats(): une todas as duplicadas que já existem (mesmo número
--    conectado e mesmo telefone) e roda ao aplicar este script.
-- =====================================================================

create or replace function public.private_phone_key(p text)
returns text language sql immutable parallel safe as $$
  select case when d ~ '^55[0-9]{2}9[0-9]{8}$' then substr(d, 1, 4) || substr(d, 6) else nullif(d, '') end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;
grant execute on function public.private_phone_key(text) to authenticated, service_role;

create index if not exists private_chats_phone_key_idx on public.private_chats (instance_id, public.private_phone_key(phone)) where phone is not null;

-- recebimento: reaproveita a conversa do mesmo telefone
create or replace function public.ingest_private_message(
  p_instance_id uuid, p_jid text, p_phone text, p_name text, p_wa_message_id text,
  p_from_me boolean, p_sender_name text, p_message_type text, p_body text, p_sent_at timestamptz,
  p_count_unread boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_chat public.private_chats%rowtype;
  v_id uuid;
begin
  select company_id into v_company from public.whatsapp_instances where id = p_instance_id;
  if v_company is null or not coalesce((select private_chats_enabled from public.companies where id = v_company), false) then
    return jsonb_build_object('inserted', false, 'disabled', true);
  end if;

  select * into v_chat from public.private_chats where instance_id = p_instance_id and jid = p_jid;
  if not found and public.private_phone_key(p_phone) is not null then
    -- a mesma pessoa por outro identificador (telefone x LID): a mesma conversa
    select * into v_chat from public.private_chats
     where instance_id = p_instance_id and phone is not null
       and public.private_phone_key(phone) = public.private_phone_key(p_phone)
     order by (assigned_to is not null) desc, last_message_at desc nulls last, created_at
     limit 1;
  end if;
  if v_chat.id is null then
    insert into public.private_chats (instance_id, company_id, jid, phone, name)
    values (p_instance_id, v_company, p_jid, p_phone, p_name)
    on conflict (instance_id, jid) do update
      set phone = coalesce(public.private_chats.phone, excluded.phone),
          name = coalesce(excluded.name, public.private_chats.name)
    returning * into v_chat;
  else
    update public.private_chats
       set phone = coalesce(phone, p_phone), name = coalesce(p_name, name)
     where id = v_chat.id
    returning * into v_chat;
  end if;

  insert into public.private_messages (chat_id, company_id, wa_message_id, from_me, sender_name, message_type, body, sent_at)
  values (v_chat.id, v_company, p_wa_message_id, p_from_me, p_sender_name, p_message_type, p_body, p_sent_at)
  on conflict (chat_id, wa_message_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('inserted', false, 'chat_id', v_chat.id);
  end if;

  update public.private_chats
     set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at),
         last_message_preview = case when last_message_at is null or p_sent_at >= last_message_at
                                     then left(coalesce(p_body, '[' || p_message_type || ']'), 140) else last_message_preview end,
         unread_count = case when p_from_me then 0 when p_count_unread then unread_count + 1 else unread_count end
   where id = v_chat.id;
  return jsonb_build_object('inserted', true, 'chat_id', v_chat.id, 'message_id', v_id);
end;
$$;
revoke all on function public.ingest_private_message(uuid, text, text, text, text, boolean, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ingest_private_message(uuid, text, text, text, text, boolean, text, text, text, timestamptz, boolean) to service_role;

-- une duas conversas do mesmo número conectado (a segunda é apagada)
create or replace function public.merge_private_chats(p_keep uuid, p_drop uuid)
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
  if k.id is null or d.id is null or k.instance_id <> d.instance_id then
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
revoke all on function public.merge_private_chats(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_private_chats(uuid, uuid) to service_role;

-- une todas as duplicadas (mesmo número conectado e mesmo telefone); devolve quantas conversas foram unidas
create or replace function public.merge_duplicate_private_chats()
returns int
language plpgsql security definer set search_path = public as $$
declare
  g record;
  keep uuid;
  dup uuid;
  n int := 0;
begin
  for g in
    select instance_id, public.private_phone_key(phone) as pkey
      from public.private_chats
     where phone is not null and public.private_phone_key(phone) is not null
     group by 1, 2 having count(*) > 1
  loop
    -- mantém a que tem responsável, depois a com mais mensagens, depois a mais antiga
    select c.id into keep from public.private_chats c
     where c.instance_id = g.instance_id and public.private_phone_key(c.phone) = g.pkey
     order by (c.assigned_to is not null) desc,
              (select count(*) from public.private_messages m where m.chat_id = c.id) desc,
              c.created_at
     limit 1;
    for dup in
      select c.id from public.private_chats c
       where c.instance_id = g.instance_id and public.private_phone_key(c.phone) = g.pkey and c.id <> keep
    loop
      perform public.merge_private_chats(keep, dup);
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.merge_duplicate_private_chats() from public, anon, authenticated;
grant execute on function public.merge_duplicate_private_chats() to service_role;

-- une as que já existem
select public.merge_duplicate_private_chats();
