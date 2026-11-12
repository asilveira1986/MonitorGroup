-- =====================================================================
-- Pesquisa de mensagens (grupos e conversas privadas), como no WhatsApp.
--
--  * search_norm(texto): minúsculas e sem acento, para "audiencia" achar
--    "Audiência". Usa a extensão unaccent quando ela existe; sem ela, só
--    minúsculas.
--  * search_group_messages / search_private_messages: devolvem as mensagens
--    que contêm o texto, da mais nova para a mais antiga. Rodam com o
--    usuário que pergunta (security invoker): só aparece o que ele já pode
--    ver (grupos e conversas dos setores dele, as que atende etc.).
--      - p_group / p_chat: pesquisa dentro de uma conversa só; vazio =
--        em todas as que a pessoa vê.
--      - mensagens apagadas, ocultas ("apagar para mim") e anonimizadas
--        não entram.
--  * Índice trigrama (pg_trgm) no texto das mensagens, para a pesquisa
--    geral não varrer a tabela toda. Se a extensão não puder ser criada, a
--    pesquisa continua funcionando, só mais devagar.
-- =====================================================================

do $$
begin
  begin
    create extension if not exists unaccent with schema extensions;
  exception when others then
    begin
      create extension if not exists unaccent;
    exception when others then
      raise notice 'unaccent indisponível: a pesquisa ignora só maiúsculas/minúsculas';
    end;
  end;
  begin
    create extension if not exists pg_trgm with schema extensions;
  exception when others then
    begin
      create extension if not exists pg_trgm;
    exception when others then
      raise notice 'pg_trgm indisponível: a pesquisa geral fica mais lenta';
    end;
  end;
end $$;

-- minúsculas e sem acento (imutável, para poder indexar)
do $$
begin
  if to_regprocedure('extensions.unaccent(text)') is not null or to_regprocedure('public.unaccent(text)') is not null then
    execute $f$
      create or replace function public.search_norm(t text) returns text
      language sql immutable parallel safe set search_path = public, extensions
      as $b$ select lower(unaccent(coalesce(t, ''))) $b$
    $f$;
  else
    execute $f$
      create or replace function public.search_norm(t text) returns text
      language sql immutable parallel safe
      as $b$ select lower(coalesce(t, '')) $b$
    $f$;
  end if;
end $$;
grant execute on function public.search_norm(text) to authenticated;

-- índices trigrama (opcionais)
do $$
begin
  perform set_config('search_path', current_setting('search_path') || ', extensions', true);
  execute 'create index if not exists messages_body_search_idx on public.messages using gin (public.search_norm(body) gin_trgm_ops) where body is not null';
  execute 'create index if not exists private_messages_body_search_idx on public.private_messages using gin (public.search_norm(body) gin_trgm_ops) where body is not null';
exception when others then
  raise notice 'índice de pesquisa não criado (%): a pesquisa funciona, só mais devagar', sqlerrm;
end $$;

-- o texto digitado vira um padrão LIKE seguro (% e _ valem como letras comuns)
create or replace function public.search_pattern(p_term text) returns text
language sql immutable parallel safe as $$
  select '%' || replace(replace(replace(public.search_norm(btrim(p_term)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
grant execute on function public.search_pattern(text) to authenticated;

-- grupos
create or replace function public.search_group_messages(p_term text, p_group uuid default null, p_limit int default 50)
returns table (id uuid, group_id uuid, group_name text, sender_name text, from_me boolean, message_type text, body text, sent_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.id, m.group_id, g.name, m.sender_name, m.from_me, m.message_type, m.body, m.sent_at
    from public.messages m
    join public.groups g on g.id = m.group_id
   where char_length(btrim(coalesce(p_term, ''))) >= 2
     and (p_group is null or m.group_id = p_group)
     and m.body is not null
     and m.deleted_at is null and m.hidden_at is null and m.anonymized_at is null
     and not public.is_technical_message_type(m.message_type)
     and public.search_norm(m.body) like public.search_pattern(p_term)
   order by m.sent_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke all on function public.search_group_messages(text, uuid, int) from public, anon;
grant execute on function public.search_group_messages(text, uuid, int) to authenticated;

-- conversas privadas
create or replace function public.search_private_messages(p_term text, p_chat uuid default null, p_limit int default 50)
returns table (id uuid, chat_id uuid, chat_name text, chat_phone text, from_me boolean, message_type text, body text, sent_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.id, m.chat_id, c.name, c.phone, m.from_me, m.message_type, m.body, m.sent_at
    from public.private_messages m
    join public.private_chats c on c.id = m.chat_id
   where char_length(btrim(coalesce(p_term, ''))) >= 2
     and (p_chat is null or m.chat_id = p_chat)
     and m.body is not null
     and m.deleted_at is null and m.hidden_at is null and m.anonymized_at is null
     and public.search_norm(m.body) like public.search_pattern(p_term)
   order by m.sent_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke all on function public.search_private_messages(text, uuid, int) from public, anon;
grant execute on function public.search_private_messages(text, uuid, int) to authenticated;
