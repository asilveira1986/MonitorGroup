-- =====================================================================
-- Contatos com nome e foto.
--
--  * Foto: a lista de contatos traz a foto de perfil do WhatsApp que o
--    worker guarda (agora também dos contatos da agenda e das conversas
--    privadas, não só dos membros dos grupos).
--  * Nome: quem não tem nome salvo na agenda nem no sistema aparece com o
--    nome que usa no WhatsApp; se esse nome não veio com o contato, vale
--    o nome visto nos grupos de que a pessoa participa.
-- =====================================================================

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
    -- cadastrados no sistema (o nome do sistema vale primeiro)
    select coalesce(k.phone || '@s.whatsapp.net', 'contact:' || k.id) as jid, k.phone, k.name, null::text as notify,
           'sistema'::text as origem, 0 as prio, k.id as contact_id, null::uuid as chat_id,
           k.email, k.organization, k.notes, k.tags
      from public.contacts k
     where k.company_id = v_company
    union all
    -- agenda do WhatsApp (nome salvo = prioridade 1)
    select w.jid, w.phone, w.name, w.notify, 'agenda', case when w.name is not null then 1 else 4 end,
           null, null, null, null, null, null
      from public.wa_contacts w
     where w.company_id = v_company
       and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    union all
    -- conversas privadas (números digitados no sistema e quem escreveu no privado)
    select c.jid, c.phone, c.name, null, 'conversa', case when c.name is not null then 2 else 5 end,
           null, c.id, null, null, null, c.tags
      from public.private_chats c
     where c.company_id = v_company
    union all
    -- pessoas da equipe com WhatsApp
    select t.phone || '@s.whatsapp.net', t.phone, t.name, null, 'equipe', 3, null, null, null, null, null, null
      from public.team_members t
     where t.company_id = v_company and t.active and t.phone is not null
    union all
    -- membros dos grupos: só completam o nome usado no WhatsApp (não entram sozinhos na lista)
    select gp.jid, gp.phone, null, nullif(btrim(gp.name), ''), 'membro', 6, null, null, null, null, null, null
      from public.group_participants gp
     where gp.company_id = v_company and nullif(btrim(gp.name), '') is not null
       and gp.name !~ '^[0-9 +()-]+$'
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k,
           exists (select 1 from public.contact_avatars a
                    where a.company_id = v_company and a.jid = s.jid and a.path is not null) as has_photo
      from src s
  ), merged as (
    select k,
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify order by prio) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid) filter (where origem <> 'membro'))[1]) as jid,
           -- a foto de perfil guardada pelo worker (de qualquer identificador da pessoa)
           (array_agg(jid order by prio) filter (where has_photo))[1] as photo_jid,
           (array_agg(contact_id) filter (where contact_id is not null))[1] as contact_id,
           (array_agg(chat_id) filter (where chat_id is not null))[1] as chat_id,
           (array_agg(email) filter (where email is not null))[1] as email,
           (array_agg(organization) filter (where organization is not null))[1] as organization,
           (array_agg(notes) filter (where notes is not null))[1] as notes,
           -- etiquetas: as do cadastro; sem cadastro, as da conversa
           coalesce((array_agg(to_jsonb(tags) order by prio) filter (where tags is not null and tags <> '{}'))[1], '[]'::jsonb) as tags,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe,
           bool_or(origem <> 'membro') as listed
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe,
           'id', contact_id, 'chat_id', chat_id, 'email', email, 'organization', organization, 'notes', notes,
           'tags', tags, 'photo', photo_jid)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where m.listed and (v_term is null
              or m.name ilike '%' || v_term || '%' or m.notify ilike '%' || v_term || '%'
              or m.email ilike '%' || v_term || '%' or m.organization ilike '%' || v_term || '%'
              or (v_digits is not null and length(v_digits) >= 3 and m.phone like '%' || v_digits || '%'))
       order by (m.name is null and m.notify is null), lower(coalesce(m.name, m.notify, m.phone, m.jid))
       limit greatest(1, least(coalesce(p_limit, 5000), 20000))
    ) x;
  return v_out;
end;
$$;
grant execute on function public.contact_directory(text, int) to authenticated;
