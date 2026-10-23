-- =====================================================================
-- Nome salvo nas conversas privadas também pelo número.
--
-- O mesmo celular brasileiro aparece com e sem o 9 (55 51 9xxxx-xxxx e
-- 55 51 xxxx-xxxx: o WhatsApp guarda o número como foi registrado). O nome
-- salvo na agenda agora passa para a conversa e entre os contatos pelo
-- número, nas duas formas, além do JID/LID.
-- =====================================================================

-- chave do número para comparar: celular do Brasil sem o 9 (55 + DDD + 8 dígitos)
create or replace function public.phone_key(p_phone text)
returns text
language sql immutable
as $$
  select case
    when d ~ '^55[1-9][0-9]9[0-9]{8}$' then left(d, 4) || right(d, 8)
    else nullif(d, '')
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x;
$$;

create index if not exists wa_contacts_phone_key_idx on public.wa_contacts (instance_id, public.phone_key(phone)) where phone is not null;

create or replace function public.link_wa_contacts(p_instance_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- telefone para a linha do LID
  update public.wa_contacts t
     set phone = s.phone, updated_at = now()
    from public.wa_contacts s
   where t.instance_id = p_instance_id and s.instance_id = p_instance_id
     and t.jid <> s.jid and t.phone is null and s.phone is not null
     and (t.jid = s.lid or (t.lid is not null and t.lid = s.lid));
  -- nome salvo para a outra linha da mesma pessoa (pelo LID ou pelo número, com ou sem o 9)
  update public.wa_contacts t
     set name = s.name, updated_at = now()
    from public.wa_contacts s
   where t.instance_id = p_instance_id and s.instance_id = p_instance_id
     and t.jid <> s.jid and t.name is null and s.name is not null
     and ((t.phone is not null and public.phone_key(t.phone) = public.phone_key(s.phone))
          or (t.lid is not null and (t.lid = s.lid or t.lid = s.jid))
          or (s.lid is not null and s.lid = t.jid));
  -- conversas: nome salvo no lugar de nenhum nome, do nome do WhatsApp ou só do número
  update public.private_chats c
     set name = w.name
    from public.wa_contacts w
   where c.instance_id = p_instance_id and w.instance_id = p_instance_id
     and w.name is not null and c.name is distinct from w.name
     and (w.jid = c.jid or (c.phone is not null and public.phone_key(w.phone) = public.phone_key(c.phone)))
     and (c.name is null or c.name = w.notify or c.name ~ '^[0-9 +()-]+$');
end;
$$;
revoke all on function public.link_wa_contacts(uuid) from public, anon, authenticated;
grant execute on function public.link_wa_contacts(uuid) to service_role;

-- abrir conversa: nome salvo também pelo número
create or replace function public.start_private_chat(p_jid text default null, p_phone text default null, p_name text default null)
returns public.private_chats
language plpgsql security definer set search_path = public
as $$
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
  return v_row;
end;
$$;
revoke all on function public.start_private_chat(text, text, text) from public, anon;
grant execute on function public.start_private_chat(text, text, text) to authenticated;

-- acerta as conversas e contatos já gravados
do $$
declare
  v_id uuid;
begin
  for v_id in select distinct instance_id from public.wa_contacts loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;
