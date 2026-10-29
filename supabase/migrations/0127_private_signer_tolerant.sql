-- =====================================================================
-- Assinatura "*Nome:*" (0125/0126) mais tolerante ao jeito de escrever:
--   *Plinio Silva:*   *Plinio Silva*:   Plinio Silva:   * Plinio Silva :*
-- e com caracteres invisíveis no começo (alguns aparelhos e extensões do
-- WhatsApp Web colocam marcas de direção do texto antes da mensagem).
-- O nome continua tendo que ser o de um usuário do sistema; "Obs:" e
-- parecidos não batem com ninguém e não mudam nada.
-- =====================================================================

create or replace function public.private_signature(p_body text)
returns text language sql immutable set search_path = public as $$
  select public.private_name_key((regexp_match(coalesce(p_body, ''),
    '^[\s ​-‏‪-‮⁠﻿]*\*?\s*([^*\n:]{2,80})\*?\s*:\s*\*?'))[1])
$$;

create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public.private_signature(p_body);
  v_ids uuid[];
begin
  if v_name is null then
    return null;
  end if;
  select array_agg(p.id) into v_ids from public.profiles p
   where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
     and public.private_name_key(public.user_display_name(p.id)) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    -- só o primeiro nome ("*Plinio:*")
    select array_agg(p.id) into v_ids from public.profiles p
     where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
       and split_part(public.private_name_key(public.user_display_name(p.id)), ' ', 1) = v_name;
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
