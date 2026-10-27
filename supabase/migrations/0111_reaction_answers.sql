-- =====================================================================
-- Reação da equipe conta como resposta.
--
-- Quando a equipe (o número conectado ou alguém cadastrado em Pessoas)
-- reage a uma mensagem do cliente (👍 🙏 😂 ...), o grupo deixa de
-- aguardar resposta, desde que não haja mensagem do cliente depois da que
-- recebeu a reação. Os alertas de "sem resposta" do grupo são resolvidos.
-- Liga/desliga em Configurações › WhatsApp › Respostas e mensagens
-- (começa ligado). Os grupos que já estão aguardando e têm essa reação
-- também são acertados.
-- =====================================================================

alter table public.app_settings add column if not exists reaction_answers boolean not null default true;

-- o worker chama ao gravar a reação da equipe (p_message: a mensagem que recebeu a reação)
create or replace function public.answer_by_reaction(p_message uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
  g public.groups%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if m.id is null or m.from_team then
    return false;
  end if;
  select * into g from public.groups where id = m.group_id;
  if g.id is null or g.pending_since is null
     or not coalesce((select reaction_answers from public.app_settings where company_id = g.company_id), true) then
    return false;
  end if;
  -- o cliente escreveu de novo depois da mensagem que recebeu a reação: ainda aguarda
  if exists (select 1 from public.messages x
              where x.group_id = m.group_id and not x.from_team and x.opens_pending and not x.ignored_as_last
                and x.sent_at > m.sent_at) then
    return false;
  end if;
  update public.groups set pending_since = null, pending_message_id = null, pending_count = 0 where id = g.id;
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = g.id and type = 'no_response' and status <> 'resolved';
  return true;
end;
$$;
revoke all on function public.answer_by_reaction(uuid) from public, anon, authenticated;
grant execute on function public.answer_by_reaction(uuid) to service_role;

-- os grupos que já aguardam e têm reação da equipe na última mensagem do cliente
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct on (m.group_id) m.id
      from public.message_reactions x
      join public.messages m on m.id = x.message_id and not m.from_team
      join public.groups g on g.id = m.group_id and g.pending_since is not null
     where x.from_team and m.sent_at >= g.pending_since
     order by m.group_id, m.sent_at desc
  loop
    if public.answer_by_reaction(r.id) then
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice '% grupo(s) respondidos por reação da equipe', v_n;
end $$;
