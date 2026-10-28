-- =====================================================================
-- Contatos: a agenda do WhatsApp conectado e os contatos do sistema numa
-- tela só (menu Contatos).
--
--  * contacts: contatos cadastrados no sistema (nome, telefone, e-mail,
--    empresa, observações e etiquetas). Um por telefone na empresa.
--  * Editar um contato da agenda do WhatsApp cria o cadastro dele no
--    sistema: o nome do sistema passa a valer no painel (a agenda do
--    celular não muda).
--  * O nome do contato vale também nas conversas privadas com o mesmo
--    número (as que já existem e as que começarem depois), e as etiquetas
--    ficam iguais nas duas.
--  * contact_directory() passa a trazer os contatos do sistema, com o
--    e-mail, a empresa, as observações, as etiquetas e a conversa.
--  * Mesmo acesso das conversas privadas. O pedido do titular (LGPD)
--    também apaga e exporta o cadastro.
-- =====================================================================

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  phone        text,
  email        text,
  organization text,
  notes        text,
  tags         uuid[] not null default '{}',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists contacts_company_phone_key on public.contacts (company_id, public.phone_key(phone)) where phone is not null;
create index if not exists contacts_company_name_idx on public.contacts (company_id, lower(name));
alter table public.contacts enable row level security;
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
revoke all on public.contacts from anon;
grant select on public.contacts to authenticated;
grant select, insert, update, delete on public.contacts to service_role;

-- ------------------------------------------------ salvar (novo ou edição)
create or replace function public.save_contact(
  p_id uuid, p_name text, p_phone text, p_email text default null, p_organization text default null,
  p_notes text default null, p_tags uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := public.br_phone(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tags uuid[] := public.clean_customer_tags(coalesce(p_tags, '{}'));
  v_old text;
  v_id uuid;
begin
  if not public.can_use_private_chats() then
    raise exception 'Os contatos não estão liberados para você nesta empresa.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Informe o nome do contato.';
  end if;
  if v_phone is not null and (length(v_phone) < 12 or length(v_phone) > 15) then
    raise exception 'Informe o número com DDD (e o código do país, se não for do Brasil).';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Informe o telefone ou o e-mail do contato.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;

  if p_id is not null then
    select phone into v_old from public.contacts where id = p_id and company_id = v_company;
    if not found then
      raise exception 'Contato não encontrado.';
    end if;
    v_id := p_id;
  elsif v_phone is not null then
    -- o mesmo número já cadastrado: atualiza o cadastro (com ou sem o 9 do celular)
    select id, phone into v_id, v_old from public.contacts
     where company_id = v_company and public.phone_key(phone) = public.phone_key(v_phone);
  end if;
  if v_phone is not null and exists (
       select 1 from public.contacts where company_id = v_company and id is distinct from v_id
          and public.phone_key(phone) = public.phone_key(v_phone)) then
    raise exception 'Já existe outro contato com este número.';
  end if;

  if v_id is null then
    insert into public.contacts (company_id, name, phone, email, organization, notes, tags, created_by)
    values (v_company, left(v_name, 120), v_phone, left(v_email, 200), left(nullif(btrim(coalesce(p_organization, '')), ''), 120),
            left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), v_tags, auth.uid())
    returning id into v_id;
  else
    update public.contacts
       set name = left(v_name, 120), phone = v_phone, email = left(v_email, 200),
           organization = left(nullif(btrim(coalesce(p_organization, '')), ''), 120),
           notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), tags = v_tags, updated_at = now()
     where id = v_id;
  end if;

  -- conversas com o mesmo número: o nome e as etiquetas do contato
  if v_phone is not null then
    update public.private_chats c
       set name = left(v_name, 120), tags = v_tags
     where c.company_id = v_company and public.phone_key(c.phone) = public.phone_key(v_phone)
       and (c.name is distinct from left(v_name, 120) or c.tags is distinct from v_tags);
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_contact(uuid, text, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.save_contact(uuid, text, text, text, text, text, uuid[]) to authenticated;

create or replace function public.delete_contact(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_private_chats() then
    raise exception 'Os contatos não estão liberados para você nesta empresa.' using errcode = '42501';
  end if;
  delete from public.contacts where id = p_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Contato não encontrado.';
  end if;
end;
$$;
revoke all on function public.delete_contact(uuid) from public, anon;
grant execute on function public.delete_contact(uuid) to authenticated;

-- conversa com um número cadastrado: fica com o nome do contato (o WhatsApp não troca a cada
-- mensagem); a conversa nova já entra com as etiquetas dele
create or replace function public.private_chats_contact_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k public.contacts%rowtype;
begin
  if new.phone is null then
    return new;
  end if;
  select * into k from public.contacts
   where company_id = new.company_id and public.phone_key(phone) = public.phone_key(new.phone);
  if k.id is not null then
    new.name := k.name;
    if tg_op = 'INSERT' then
      new.tags := k.tags;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists private_chats_contact_name on public.private_chats;
create trigger private_chats_contact_name before insert or update of name, phone on public.private_chats
  for each row execute function public.private_chats_contact_name();

-- etiqueta excluída: sai dos grupos, das conversas e dos contatos
create or replace function public.customer_tags_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system_notice', 'on', true);
  update public.groups set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  perform set_config('app.system_notice', 'off', true);
  update public.private_chats set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  update public.contacts set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  return old;
end;
$$;

-- ------------------------------------------------ a lista: sistema + agenda do WhatsApp + conversas + equipe
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
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k from src s
  ), merged as (
    select k,
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid))[1]) as jid,
           (array_agg(contact_id) filter (where contact_id is not null))[1] as contact_id,
           (array_agg(chat_id) filter (where chat_id is not null))[1] as chat_id,
           (array_agg(email) filter (where email is not null))[1] as email,
           (array_agg(organization) filter (where organization is not null))[1] as organization,
           (array_agg(notes) filter (where notes is not null))[1] as notes,
           -- etiquetas: as do cadastro; sem cadastro, as da conversa
           coalesce((array_agg(to_jsonb(tags) order by prio) filter (where tags is not null and tags <> '{}'))[1], '[]'::jsonb) as tags,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe,
           'id', contact_id, 'chat_id', chat_id, 'email', email, 'organization', organization, 'notes', notes,
           'tags', tags)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where (v_term is null
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

-- ------------------------------------------------ LGPD: o cadastro no sistema entra no pedido do titular
create or replace function public.lgpd_person_export(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_res jsonb;
begin
  select jsonb_build_object(
    'gerado_em', now(),
    'empresa', (select name from public.companies where id = v_company),
    'telefone', v_digits,
    'identificadores', to_jsonb(v_jids),
    'participacao_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'nome', gp.name, 'telefone', gp.phone, 'papel', gp.role, 'entrou_em', gp.joined_at, 'saiu_em', gp.left_at))
        from public.group_participants gp join public.groups g on g.id = gp.group_id
       where gp.company_id = v_company and gp.jid = any(v_jids)), '[]'),
    'contato_no_whatsapp', coalesce((select jsonb_agg(jsonb_build_object('nome_salvo', w.name, 'nome_whatsapp', w.notify, 'telefone', w.phone))
        from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)), '[]'),
    'mensagens_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'enviada_em', m.sent_at, 'nome', m.sender_name, 'tipo', m.message_type, 'texto', m.body) order by m.sent_at)
        from public.messages m join public.groups g on g.id = m.group_id
       where g.company_id = v_company and m.anonymized_at is null and not m.from_me
         and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)), '[]'),
    'conversas_privadas', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.name, 'telefone', c.phone,
        'mensagens', coalesce((select jsonb_agg(jsonb_build_object(
            'enviada_em', pm.sent_at, 'de', case when pm.from_me then 'empresa' else 'titular' end,
            'tipo', pm.message_type, 'texto', pm.body) order by pm.sent_at)
          from public.private_messages pm where pm.chat_id = c.id and pm.anonymized_at is null), '[]')))
        from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids)), '[]'),
    'reacoes', coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'em', r.reacted_at))
        from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids)), '[]'),
    'cadastro_no_sistema', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', k.name, 'telefone', k.phone, 'email', k.email, 'empresa', k.organization, 'observacoes', k.notes))
        from public.contacts k where k.company_id = v_company and public.phone_key(k.phone) = v_key), '[]')
  ) into v_res;
  perform public.lgpd_log('exportou', v_digits, jsonb_build_object(
    'mensagens', jsonb_array_length(v_res->'mensagens_em_grupos'), 'conversas', jsonb_array_length(v_res->'conversas_privadas')));
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_export(text) from public, anon;
grant execute on function public.lgpd_person_export(text) to authenticated;

create or replace function public.lgpd_person_erase(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_paths text[] := '{}';
  v_part text[];
  v_msgs int := 0;
  v_chats int := 0;
  v_other int;
  v_res jsonb;
begin
  if exists (select 1 from public.team_members t where t.company_id = v_company and public.phone_key(t.phone) = v_key) then
    raise exception 'Este telefone é de um atendente: remova-o da equipe antes (Configurações › Atendentes).';
  end if;
  perform set_config('app.activity_skip', 'on', true);

  -- mensagens dela nos grupos: sai o conteúdo e quem mandou
  with alvo as (
    select m.id, m.media_path as old_path from public.messages m join public.groups g on g.id = m.group_id
     where g.company_id = v_company and not m.from_me
       and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)
  ), u as (
    update public.messages m
       set body = null, original_body = null, sender_name = null, sender_phone = null, sender_jid = null,
           quoted_body = null, quoted_sender_jid = null,
           media_path = null, media_status = case when m.media_path is not null then 'expired' else m.media_status end,
           anonymized_at = now()
      from alvo
     where m.id = alvo.id
    returning alvo.old_path
  )
  select count(*), coalesce(array_agg(old_path) filter (where old_path is not null), '{}') into v_msgs, v_part from u;
  v_paths := v_paths || v_part;
  -- citações dela em respostas de outros
  update public.messages m set quoted_body = null, quoted_sender_jid = null
    from public.groups g where g.id = m.group_id and g.company_id = v_company and m.quoted_sender_jid = any(v_jids);

  -- conversas privadas (com as mensagens, reações e envios)
  select coalesce(array_agg(pm.media_path) filter (where pm.media_path is not null), '{}') into v_part
    from public.private_messages pm join public.private_chats c on c.id = pm.chat_id
   where c.company_id = v_company and c.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids);
  get diagnostics v_chats = row_count;

  delete from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids);
  delete from public.message_receipts r where r.company_id = v_company and r.user_jid = any(v_jids);
  delete from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids);
  delete from public.contacts k where k.company_id = v_company and public.phone_key(k.phone) = v_key;
  select coalesce(array_agg(a.path) filter (where a.path is not null), '{}') into v_part
    from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  -- membros: sai nome e telefone (a pessoa segue no grupo do WhatsApp; o worker volta a listá-la se
  -- continuar lá)
  delete from public.group_participants gp where gp.company_id = v_company and gp.jid = any(v_jids);
  get diagnostics v_other = row_count;

  perform set_config('app.activity_skip', 'off', true);
  v_res := jsonb_build_object('mensagens_grupos', v_msgs, 'conversas_privadas', v_chats, 'participacoes', v_other,
                              'arquivos', to_jsonb(v_paths));
  perform public.lgpd_log('apagou', v_digits, v_res - 'arquivos');
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_erase(text) from public, anon;
grant execute on function public.lgpd_person_erase(text) to authenticated;
