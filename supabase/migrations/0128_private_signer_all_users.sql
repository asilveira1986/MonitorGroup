-- =====================================================================
-- Assinatura "*Nome:*" (0125-0127) para todos os usuários, sem precisar
-- acertar cadastro:
--
--  * vale qualquer usuário ativo da empresa (qualquer perfil);
--  * o nome pode ser o do usuário ou o da pessoa na equipe (Pessoas);
--  * nome completo ou abreviado: "*Elen Regert:*" encontra "Elen Leticia
--    Pergher Regert", e "*Elen Leticia Pergher Regert:*" encontra "Elen
--    Regert" (mesmo primeiro nome e os outros nomes contidos no do outro);
--  * só o primeiro nome, se for de um usuário só.
-- Se mais de um usuário servir, a conversa continua aguardando.
-- =====================================================================

-- os nomes de cada usuário ativo da empresa (o do usuário e o da pessoa na equipe), em palavras
create or replace function public.private_signer_names(p_company uuid)
returns table (id uuid, words text[]) language sql stable security definer set search_path = public as $$
  select distinct x.id, string_to_array(x.k, ' ')
    from (select p.id, public.private_name_key(public.user_display_name(p.id)) as k
            from public.profiles p where p.company_id = p_company and p.active
          union
          select p.id, public.private_name_key(t.name)
            from public.team_members t
            join public.profiles p on p.company_id = t.company_id and p.active and lower(p.email) = lower(t.user_email)
           where t.company_id = p_company) x
   where x.k is not null
$$;
revoke all on function public.private_signer_names(uuid) from public, anon, authenticated;

create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public.private_signature(p_body);
  v_words text[];
  v_ids uuid[];
begin
  if v_name is null then
    return null;
  end if;
  v_words := string_to_array(v_name, ' ');

  -- 1) nome igual
  select array_agg(distinct id) into v_ids from public.private_signer_names(p_company) where words = v_words;
  -- 2) mesmo primeiro nome e um nome contido no outro (abreviado ou completo)
  if coalesce(array_length(v_ids, 1), 0) = 0 and array_length(v_words, 1) > 1 then
    select array_agg(distinct id) into v_ids from public.private_signer_names(p_company)
     where words[1] = v_words[1] and array_length(words, 1) > 1 and (words @> v_words or words <@ v_words);
  end if;
  -- 3) só o primeiro nome ("*Plinio:*")
  if coalesce(array_length(v_ids, 1), 0) = 0 and array_length(v_words, 1) = 1 then
    select array_agg(distinct id) into v_ids from public.private_signer_names(p_company) where words[1] = v_words[1];
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
