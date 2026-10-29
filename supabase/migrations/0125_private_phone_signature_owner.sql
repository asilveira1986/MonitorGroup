-- =====================================================================
-- Conversa privada respondida direto pelo WhatsApp (celular / WhatsApp
-- Web) com a assinatura "*Nome:*" no começo: fica com o usuário do
-- sistema que tem esse nome, como se tivesse respondido pelo painel.
--
--  * Só a conversa sem responsável (aguardando) ou a finalizada (reabre).
--  * O nome é o do usuário no sistema (nome completo; ou só o primeiro
--    nome, se for de um usuário só). Nome que não bate, ou que bate com
--    mais de um usuário: a conversa continua como está.
--  * Mensagem sem assinatura: não há como saber quem enviou.
-- =====================================================================

-- o usuário da empresa que assina com este nome (null se nenhum ou mais de um)
create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := lower(btrim((regexp_match(coalesce(p_body, ''), '^\s*\*([^*\n]{2,80}):\*'))[1]));
  v_ids uuid[];
begin
  if v_name is null or v_name = '' then
    return null;
  end if;
  select array_agg(p.id) into v_ids from public.profiles p
   where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
     and lower(btrim(public.user_display_name(p.id))) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    -- só o primeiro nome ("*Lurian:*")
    select array_agg(p.id) into v_ids from public.profiles p
     where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
       and lower(split_part(btrim(public.user_display_name(p.id)), ' ', 1)) = v_name;
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

create or replace function public.private_messages_signer_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not new.from_me or auth.uid() is not null then
    return new;                                   -- só o que o worker registra
  end if;
  if not exists (select 1 from public.private_chats c
                  where c.id = new.chat_id
                    and ((c.assigned_to is null and c.closed_at is null) or (c.closed_at is not null and new.sent_at > c.closed_at))) then
    return new;
  end if;
  v_user := public.private_signer(new.company_id, new.body);
  if v_user is null then
    return new;
  end if;
  update public.private_chats
     set assigned_to = v_user, assigned_at = now(), closed_at = null, closed_by = null
   where id = new.chat_id
     and ((assigned_to is null and closed_at is null) or (closed_at is not null and new.sent_at > closed_at));
  return new;
end;
$$;
drop trigger if exists private_messages_signer_owner on public.private_messages;
create trigger private_messages_signer_owner after insert on public.private_messages
  for each row execute function public.private_messages_signer_owner();

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
