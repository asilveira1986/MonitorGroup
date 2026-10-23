-- =====================================================================
-- Contatos com o nome salvo na agenda.
--
-- O WhatsApp manda a mesma pessoa de dois jeitos: pela agenda (número,
-- com o nome salvo) e pelos grupos (LID, só com o nome que ela usa no
-- WhatsApp). Agora:
--  * a gravação mescla: um campo que não veio não apaga o que já havia;
--  * o nome salvo passa entre o número e o LID da mesma pessoa (e o
--    telefone para a linha do LID);
--  * as conversas privadas sem nome (ou com o nome do WhatsApp / só o
--    número) passam a mostrar o nome salvo.
-- =====================================================================

create index if not exists wa_contacts_phone_idx on public.wa_contacts (instance_id, phone) where phone is not null;
create index if not exists wa_contacts_lid_idx on public.wa_contacts (instance_id, lid) where lid is not null;

-- liga as linhas da mesma pessoa (número × LID) e leva o nome salvo para as conversas
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
  -- nome salvo para a outra linha da mesma pessoa
  update public.wa_contacts t
     set name = s.name, updated_at = now()
    from public.wa_contacts s
   where t.instance_id = p_instance_id and s.instance_id = p_instance_id
     and t.jid <> s.jid and t.name is null and s.name is not null
     and ((t.phone is not null and t.phone = s.phone)
          or (t.lid is not null and (t.lid = s.lid or t.lid = s.jid))
          or (s.lid is not null and s.lid = t.jid));
  -- conversas: nome salvo no lugar de nenhum nome, do nome do WhatsApp ou só do número
  update public.private_chats c
     set name = w.name
    from public.wa_contacts w
   where c.instance_id = p_instance_id and w.instance_id = p_instance_id
     and w.jid = c.jid and w.name is not null and c.name is distinct from w.name
     and (c.name is null or c.name = w.notify or c.name ~ '^[0-9 +()-]+$');
end;
$$;
revoke all on function public.link_wa_contacts(uuid) from public, anon, authenticated;
grant execute on function public.link_wa_contacts(uuid) to service_role;

-- worker: grava um lote de contatos [{jid, lid, phone, name, notify}] sem apagar o que não veio
create or replace function public.save_wa_contacts(p_instance_id uuid, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_n int;
begin
  select company_id into v_company from public.whatsapp_instances where id = p_instance_id;
  if v_company is null then
    return 0;
  end if;
  insert into public.wa_contacts as t (instance_id, company_id, jid, lid, phone, name, notify, updated_at)
  select p_instance_id, v_company, r.jid,
         max(nullif(r.lid, '')), max(nullif(r.phone, '')), max(nullif(btrim(r.name), '')), max(nullif(btrim(r.notify), '')), now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(jid text, lid text, phone text, name text, notify text)
   where nullif(r.jid, '') is not null
   group by r.jid
  on conflict (instance_id, jid) do update
    set lid = coalesce(excluded.lid, t.lid),
        phone = coalesce(excluded.phone, t.phone),
        name = coalesce(excluded.name, t.name),
        notify = coalesce(excluded.notify, t.notify),
        updated_at = now();
  get diagnostics v_n = row_count;
  perform public.link_wa_contacts(p_instance_id);
  return v_n;
end;
$$;
revoke all on function public.save_wa_contacts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_wa_contacts(uuid, jsonb) to service_role;

-- acerta os contatos e conversas já gravados
do $$
declare
  v_id uuid;
begin
  for v_id in select distinct instance_id from public.wa_contacts loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;
