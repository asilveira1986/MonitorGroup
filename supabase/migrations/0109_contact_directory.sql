-- =====================================================================
-- Lista de contatos completa (Nova conversa no privado).
--
--  * Junta, numa lista só e sem repetir a mesma pessoa:
--    - os contatos da agenda do WhatsApp conectado (nome salvo e número);
--    - quem já tem conversa privada (inclusive números digitados no
--      sistema);
--    - as pessoas da equipe (com o WhatsApp cadastrado).
--  * A mesma pessoa vinda pelo número e pelo identificador do WhatsApp
--    (LID) aparece uma vez, com o nome salvo e o número. O número do LID
--    é descoberto pelo mapeamento guardado pelo WhatsApp conectado.
--  * Antes a lista mostrava só 50 contatos; agora mostra todos (com busca
--    por nome ou número).
-- =====================================================================

-- o telefone dos contatos que só vieram pelo LID (mapeamento do WhatsApp conectado)
create or replace function public.link_wa_contacts(p_instance_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wa_contacts t
     set phone = public.lid_phone(p_instance_id, t.jid), updated_at = now()
   where t.instance_id = p_instance_id and t.phone is null and t.jid like '%@lid'
     and public.lid_phone(p_instance_id, t.jid) is not null;
  update public.wa_contacts t
     set phone = public.lid_phone(p_instance_id, t.lid), updated_at = now()
   where t.instance_id = p_instance_id and t.phone is null and t.lid like '%@lid'
     and public.lid_phone(p_instance_id, t.lid) is not null;
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
  -- conversas sem número que agora têm (pelo contato)
  update public.private_chats c
     set phone = w.phone
    from public.wa_contacts w
   where c.instance_id = p_instance_id and w.instance_id = p_instance_id
     and c.phone is null and w.phone is not null and (w.jid = c.jid or w.lid = c.jid);
end;
$$;
revoke all on function public.link_wa_contacts(uuid) from public, anon, authenticated;
grant execute on function public.link_wa_contacts(uuid) to service_role;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.whatsapp_instances loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;

-- a lista: agenda do WhatsApp + conversas + equipe, uma linha por pessoa
create or replace function public.contact_directory(p_search text default null, p_limit int default 5000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_out jsonb;
begin
  if not public.can_use_private_chats() then
    return '[]'::jsonb;
  end if;
  with src as (
    -- agenda do WhatsApp (nome salvo = prioridade 1)
    select w.jid, w.phone, w.name, w.notify, 'agenda'::text as origem,
           case when w.name is not null then 1 else 4 end as prio
      from public.wa_contacts w
     where w.company_id = v_company
       and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    union all
    -- conversas privadas (números digitados no sistema e quem escreveu no privado)
    select c.jid, c.phone, c.name, null, 'conversa', case when c.name is not null then 2 else 5 end
      from public.private_chats c
     where c.company_id = v_company
    union all
    -- pessoas da equipe com WhatsApp
    select t.phone || '@s.whatsapp.net', t.phone, t.name, null, 'equipe', 3
      from public.team_members t
     where t.company_id = v_company and t.active and t.phone is not null
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k from src s
  ), merged as (
    select k,
           -- o nome mais confiável (agenda > conversa > equipe), senão o nome no WhatsApp
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid))[1]) as jid,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where (v_term is null
              or m.name ilike '%' || v_term || '%' or m.notify ilike '%' || v_term || '%'
              or (v_digits is not null and length(v_digits) >= 3 and m.phone like '%' || v_digits || '%'))
       order by (m.name is null and m.notify is null), lower(coalesce(m.name, m.notify, m.phone, m.jid))
       limit greatest(1, least(coalesce(p_limit, 5000), 20000))
    ) x;
  return v_out;
end;
$$;
grant execute on function public.contact_directory(text, int) to authenticated;
