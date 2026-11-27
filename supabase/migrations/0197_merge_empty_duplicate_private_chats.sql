-- =====================================================================
-- Limpeza das conversas privadas vazias que duplicam outra do mesmo contato.
--
-- Antes da 0196, "Nova conversa" criava uma conversa nova e vazia quando o histórico estava sob outro identificador (@lid) ou em
-- outro número conectado. Esta função junta cada uma dessas conversas vazias na conversa do mesmo contato que tem mensagens:
--
--  * só mexe em conversa SEM nenhuma mensagem e sem envio pendente, e só quando existe outra conversa do mesmo telefone (sem o 9
--    do celular) COM mensagens: conversa vazia sem par é mantida;
--  * a conversa mantida é a do mesmo número conectado, senão a mais recente em atividade;
--  * o que a vazia tinha de útil passa para a mantida: o histórico de atendimento (transferências, etc.), os alertas, as etiquetas e,
--    quando alguém TRANSFERIU a vazia depois da última atribuição da mantida, o responsável (quem só abriu a conversa, sem
--    transferir, não muda o responsável da outra);
--  * depois apaga a vazia. Pode rodar de novo: só encontra o que ainda sobrou.
-- Só o banco chama (sem permissão para usuários); o script roda uma vez no fim desta migration e devolve a lista do que juntou.
-- =====================================================================

create or replace function public.cleanup_empty_duplicate_private_chats()
returns table (empty_chat_id uuid, name text, phone text, kept_chat_id uuid, assignee_carried boolean)
language plpgsql security definer set search_path = public as $$
declare
  e public.private_chats%rowtype;
  m public.private_chats%rowtype;
  v_carry boolean;
begin
  for e in
    select c.* from public.private_chats c
     where c.last_message_at is null
       and public.phone_key(c.phone) is not null
       and not exists (select 1 from public.private_messages x where x.chat_id = c.id)
       and not exists (select 1 from public.private_outgoing o where o.chat_id = c.id and o.status in ('pending', 'sending'))
     order by c.created_at
  loop
    select k.* into m from public.private_chats k
     where k.company_id = e.company_id
       and k.id <> e.id
       and public.phone_key(k.phone) = public.phone_key(e.phone)
       and exists (select 1 from public.private_messages y where y.chat_id = k.id)
     order by (k.instance_id = e.instance_id) desc, k.last_message_at desc nulls last, k.created_at
     limit 1;
    if m.id is null then
      continue; -- sem par com mensagens: fica
    end if;

    -- responsável: só passa quando houve transferência da vazia mais nova que a atribuição da mantida
    v_carry := e.assigned_to is not null
      and exists (
        select 1 from public.private_chat_events ev
         where ev.chat_id = e.id and ev.type = 'transferred'
           and ev.created_at > coalesce(m.assigned_at, '-infinity'::timestamptz));
    update public.private_chats set
        tags = array(select distinct t from unnest(coalesce(m.tags, '{}') || coalesce(e.tags, '{}')) as t),
        assigned_to = case when v_carry then e.assigned_to else m.assigned_to end,
        assigned_at = case when v_carry then coalesce(e.assigned_at, now()) else m.assigned_at end,
        closed_at = case when v_carry then null else m.closed_at end,
        name = coalesce(m.name, e.name)
     where id = m.id;

    update public.private_chat_events set chat_id = m.id where chat_id = e.id;
    update public.alerts set private_chat_id = m.id where private_chat_id = e.id;
    delete from public.private_chats where id = e.id;

    empty_chat_id := e.id; name := e.name; phone := e.phone; kept_chat_id := m.id; assignee_carried := v_carry;
    return next;
  end loop;
end;
$$;
revoke all on function public.cleanup_empty_duplicate_private_chats() from public, anon, authenticated;

-- junta as que já existem e mostra o que foi feito (nenhuma linha = nada para juntar)
select * from public.cleanup_empty_duplicate_private_chats();

notify pgrst, 'reload schema';
