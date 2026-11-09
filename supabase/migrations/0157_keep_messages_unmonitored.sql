-- =====================================================================
-- Grupo sem monitoramento continua guardando as mensagens.
--
-- Antes, enquanto o monitoramento de um grupo estava desligado o worker
-- descartava tudo o que chegava, e ligar depois não trazia de volta o que
-- tinha chegado no intervalo (as mensagens só ficavam no celular). Agora a
-- mensagem é guardada (histórico da conversa), mas o grupo continua "fora do
-- jogo": nenhuma pendência aberta, nenhum tempo de resposta, nenhum alerta,
-- demanda, resposta automática ou pesquisa de encerramento (o worker não
-- aciona nada disso; ver worker/src/whatsapp.ts). Só atualiza a última
-- mensagem do grupo. Ao ligar o monitoramento, o grupo começa sem pendência.
--
-- O resultado ganha 'untracked': true nesse caso. Mesma assinatura e mesmas
-- permissões da 0043 (create or replace as mantém).
-- =====================================================================

create or replace function public.ingest_message(
  p_group_id        uuid,
  p_wa_message_id   text,
  p_sender_jid      text,
  p_sender_phone    text,
  p_sender_name     text,
  p_from_me         boolean,
  p_from_team       boolean,
  p_team_member_id  uuid,
  p_message_type    text,
  p_body            text,
  p_sent_at         timestamptz,
  p_opens_pending   boolean default true,  -- false para "ok", "obrigado" etc.
  p_ignored_as_last boolean default false, -- figurinha/emoji desconsiderado
  p_closes         boolean default false   -- mensagem de fechamento da equipe (\fechamento)
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_group     public.groups%rowtype;
  v_msg_id    uuid;
  v_response  int;
  v_answered  uuid;
  v_is_latest boolean;
  v_preview   text;
  v_last_client timestamptz;
  v_ignored   boolean := coalesce(p_ignored_as_last, false) and not p_from_team;
  v_closes    boolean := coalesce(p_closes, false) and p_from_team;
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at, opens_pending, ignored_as_last, closes_conversation
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at,
    coalesce(p_opens_pending, true) and not v_ignored and v_group.monitored, v_ignored, v_closes
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
  end if;

  -- grupo sem monitoramento: guarda a mensagem (histórico), sem mexer na situação do grupo:
  -- não abre pendência, não calcula tempo de resposta e não resolve alertas
  if not v_group.monitored then
    if v_group.last_message_at is null or p_sent_at >= v_group.last_message_at then
      update public.groups set
        last_message_at = p_sent_at,
        last_client_message_at = case when p_from_team then last_client_message_at else p_sent_at end,
        last_team_message_at = case when p_from_team then p_sent_at else last_team_message_at end,
        last_message_preview = left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160)
      where id = p_group_id;
    end if;
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'untracked', true);
  end if;

  -- figurinha/emoji desconsiderado: não muda a situação do grupo
  if v_ignored then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'ignored', true);
  end if;

  -- mensagens antigas (sincronização de histórico) não alteram o estado atual
  v_is_latest := v_group.last_message_at is null or p_sent_at >= v_group.last_message_at;
  v_preview := left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160);

  if not v_is_latest then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'stale', true);
  end if;

  if p_from_team then
    if v_group.pending_since is not null then
      -- tempo desde a última mensagem do cliente (não desconsiderada) antes desta resposta
      select id, sent_at into v_answered, v_last_client
      from public.messages
      where group_id = p_group_id and not from_team and not ignored_as_last
        and sent_at <= p_sent_at and sent_at >= v_group.pending_since
      order by sent_at desc, created_at desc limit 1;
      v_response := greatest(0, extract(epoch from (p_sent_at - coalesce(v_last_client, v_group.pending_since)))::int);
      v_answered := coalesce(v_answered, v_group.pending_message_id);
      update public.messages
         set response_time_seconds = v_response, answered_message_id = v_answered
       where id = v_msg_id;
    end if;

    update public.groups set
      pending_since = null,
      pending_message_id = null,
      pending_count = 0,
      last_message_at = p_sent_at,
      last_team_message_at = p_sent_at,
      last_message_preview = v_preview,
      -- \fechamento encerra a conversa; outra mensagem da equipe não reabre
      closed_at = case when v_closes then p_sent_at else closed_at end
    where id = p_group_id;

    -- resolve automaticamente alertas de "sem resposta" do grupo
    if v_response is not null then
      update public.alerts set status = 'resolved', resolved_at = now()
       where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
    end if;
  elsif not p_opens_pending and v_group.pending_since is null then
    -- agradecimento/confirmação após a resposta (ou após o fechamento): não exige
    -- nova resposta nem reabre a conversa encerrada
    update public.groups set
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  else
    -- conversa encerrada: esta mensagem do cliente inicia uma nova conversa
    update public.groups set
      conversation_started_at = case when closed_at is not null or pending_since is null then p_sent_at
                                     else conversation_started_at end,
      closed_at = null,
      pending_since = coalesce(pending_since, p_sent_at),
      pending_message_id = coalesce(pending_message_id, v_msg_id),
      pending_count = pending_count + 1,
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'message_id', v_msg_id,
    'response_time_seconds', v_response,
    'answered_message_id', v_answered
  );
end;
$$;
