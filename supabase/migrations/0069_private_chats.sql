-- =====================================================================
-- Conversas privadas (1 a 1) e contatos do WhatsApp conectado.
--
-- Módulo separado dos grupos: não entra em pendências, SLA, alertas nem
-- indicadores. Nesta primeira fase:
--  * só quem administra a plataforma vê e usa (painel › Conversas privadas);
--  * por empresa (companies.private_chats_enabled): ligado em todas, menos
--    na Flores Advogados. Desligado, o worker não grava nada do privado.
-- Tabelas: wa_contacts (contatos que o WhatsApp sincroniza), private_chats
-- (uma por contato), private_messages e private_outgoing (fila de envio).
-- =====================================================================

-- chave por empresa; na primeira vez liga em todas, menos na Flores Advogados
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'companies' and column_name = 'private_chats_enabled') then
    alter table public.companies add column private_chats_enabled boolean not null default false;
    update public.companies set private_chats_enabled = true where name not ilike '%flores%';
  end if;
end $$;

-- pode usar as conversas privadas na empresa atual?
create or replace function public.can_use_private_chats()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active_user() and public.is_platform_admin()
     and coalesce((select private_chats_enabled from public.companies where id = public.current_company_id()), false)
$$;
revoke all on function public.can_use_private_chats() from public, anon;
grant execute on function public.can_use_private_chats() to authenticated;

-- ---------------------------------------------------------------------
-- Contatos do WhatsApp conectado
-- ---------------------------------------------------------------------
create table if not exists public.wa_contacts (
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  company_id  uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  jid         text not null,            -- 5511...@s.whatsapp.net ou ...@lid
  lid         text,
  phone       text,
  name        text,                     -- nome salvo na agenda do celular
  notify      text,                     -- nome que a pessoa usa no WhatsApp
  updated_at  timestamptz not null default now(),
  primary key (instance_id, jid)
);
create index if not exists wa_contacts_company_idx on public.wa_contacts (company_id, name);

-- ---------------------------------------------------------------------
-- Conversas e mensagens
-- ---------------------------------------------------------------------
create table if not exists public.private_chats (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null references public.whatsapp_instances(id) on delete cascade,
  company_id      uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  jid             text not null,
  phone           text,
  name            text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count    int not null default 0,
  created_at      timestamptz not null default now(),
  unique (instance_id, jid)
);
create index if not exists private_chats_company_idx on public.private_chats (company_id, last_message_at desc nulls last);

create table if not exists public.private_messages (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references public.private_chats(id) on delete cascade,
  company_id    uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  wa_message_id text not null,
  from_me       boolean not null default false,
  sender_name   text,
  message_type  text not null default 'text',
  body          text,
  sent_at       timestamptz not null,
  wa_status     smallint,
  created_at    timestamptz not null default now(),
  unique (chat_id, wa_message_id)
);
create index if not exists private_messages_chat_idx on public.private_messages (chat_id, sent_at desc);

create table if not exists public.private_outgoing (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references public.private_chats(id) on delete cascade,
  company_id    uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  instance_id   uuid not null references public.whatsapp_instances(id) on delete cascade,
  body          text not null,
  status        text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  error         text,
  wa_message_id text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists private_outgoing_pending_idx on public.private_outgoing (instance_id, created_at) where status = 'pending';

-- leitura só para quem administra a plataforma, na empresa atual com o módulo ligado
alter table public.wa_contacts enable row level security;
alter table public.private_chats enable row level security;
alter table public.private_messages enable row level security;
alter table public.private_outgoing enable row level security;
drop policy if exists wa_contacts_read on public.wa_contacts;
create policy wa_contacts_read on public.wa_contacts for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
drop policy if exists private_messages_read on public.private_messages;
create policy private_messages_read on public.private_messages for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
drop policy if exists private_outgoing_read on public.private_outgoing;
create policy private_outgoing_read on public.private_outgoing for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
grant select on public.wa_contacts, public.private_chats, public.private_messages, public.private_outgoing to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.private_chats; exception when others then null; end;
  begin alter publication supabase_realtime add table public.private_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.private_outgoing; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Funções do painel
-- ---------------------------------------------------------------------

-- abre (ou acha) a conversa com um contato salvo (p_jid) ou um número novo (p_phone)
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
  else
    select * into v_contact from public.wa_contacts where instance_id = v_instance and jid = v_jid;
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

-- envia pelo número conectado (o worker manda e confere se o número tem WhatsApp)
create or replace function public.send_private_message(p_chat_id uuid, p_body text)
returns public.private_outgoing
language plpgsql security definer set search_path = public
as $$
declare
  v_chat public.private_chats%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.private_outgoing;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  select * into v_chat from public.private_chats where id = p_chat_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  if v_body = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  insert into public.private_outgoing (chat_id, company_id, instance_id, body, created_by)
  values (v_chat.id, v_chat.company_id, v_chat.instance_id, v_body, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.send_private_message(uuid, text) from public, anon;
grant execute on function public.send_private_message(uuid, text) to authenticated;

-- conversa aberta no painel: zera as não lidas
create or replace function public.mark_private_chat_read(p_chat_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.private_chats set unread_count = 0
   where id = p_chat_id and company_id = public.current_company_id() and public.can_use_private_chats();
$$;
revoke all on function public.mark_private_chat_read(uuid) from public, anon;
grant execute on function public.mark_private_chat_read(uuid) to authenticated;

-- worker: grava a mensagem e atualiza a conversa (não lidas, última mensagem)
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
  insert into public.private_chats (instance_id, company_id, jid, phone, name)
  values (p_instance_id, v_company, p_jid, p_phone, p_name)
  on conflict (instance_id, jid) do update
    set phone = coalesce(public.private_chats.phone, excluded.phone),
        name = coalesce(excluded.name, public.private_chats.name)
  returning * into v_chat;

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

-- quem administra a plataforma liga/desliga o módulo de uma empresa (tela Empresas)
create or replace function public.set_company_private_chats(p_company_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma altera este módulo.' using errcode = '42501';
  end if;
  update public.companies set private_chats_enabled = coalesce(p_enabled, false), updated_at = now() where id = p_company_id;
end;
$$;
revoke all on function public.set_company_private_chats(uuid, boolean) from public, anon;
grant execute on function public.set_company_private_chats(uuid, boolean) to authenticated;
