-- =====================================================================
-- Registro atômico de mensagens + atualização do estado da conversa.
-- Usado somente pelo worker (service_role).
--
-- Regra de negócio:
--  * Mensagem de CLIENTE abre (ou incrementa) a pendência do grupo.
--  * Mensagem da EQUIPE fecha a pendência; o tempo de resposta é medido
--    desde a primeira mensagem do cliente que ficou sem resposta.
-- =====================================================================

create or replace function public.ingest_message(
  p_group_id       uuid,
  p_wa_message_id  text,
  p_sender_jid     text,
  p_sender_phone   text,
  p_sender_name    text,
  p_from_me        boolean,
  p_from_team      boolean,
  p_team_member_id uuid,
  p_message_type   text,
  p_body           text,
  p_sent_at        timestamptz,
  p_opens_pending  boolean default true -- false para "ok", "obrigado" etc.
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
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
  end if;

  -- mensagens antigas (sincronização de histórico) não alteram o estado atual
  v_is_latest := v_group.last_message_at is null or p_sent_at >= v_group.last_message_at;
  v_preview := left(coalesce(p_sender_name || ': ', '') || coalesce(p_body, '[' || p_message_type || ']'), 160);

  if not v_is_latest then
    return jsonb_build_object('inserted', true, 'message_id', v_msg_id, 'stale', true);
  end if;

  if p_from_team then
    if v_group.pending_since is not null then
      v_response := greatest(0, extract(epoch from (p_sent_at - v_group.pending_since))::int);
      v_answered := v_group.pending_message_id;
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
      last_message_preview = v_preview
    where id = p_group_id;

    -- resolve automaticamente alertas de "sem resposta" do grupo
    if v_response is not null then
      update public.alerts set status = 'resolved', resolved_at = now()
       where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
    end if;
  elsif not p_opens_pending and v_group.pending_since is null then
    -- agradecimento/confirmação após a resposta: não exige nova resposta
    update public.groups set
      last_message_at = p_sent_at,
      last_client_message_at = p_sent_at,
      last_message_preview = v_preview
    where id = p_group_id;
  else
    update public.groups set
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

revoke all on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean) to service_role;

-- Marcar manualmente uma conversa como respondida (ex.: respondida por telefone)
create or replace function public.mark_group_answered(p_group_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  update public.groups set pending_since = null, pending_message_id = null, pending_count = 0
   where id = p_group_id;
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = p_group_id and type = 'no_response' and status <> 'resolved';
end;
$$;

grant execute on function public.mark_group_answered(uuid) to authenticated;

-- Reclassifica um remetente como membro da equipe e recalcula
-- as mensagens dele (não altera o histórico de tempos de resposta).
create or replace function public.mark_sender_as_team(p_sender_jid text, p_name text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  insert into public.team_members (name, jid, phone)
  values (p_name, p_sender_jid, nullif(p_phone, ''))
  on conflict (jid) where jid is not null do update set name = excluded.name, active = true
  returning id into v_id;

  update public.messages set from_team = true, team_member_id = v_id
   where sender_jid = p_sender_jid and not from_team;
  return v_id;
end;
$$;

grant execute on function public.mark_sender_as_team(text, text, text) to authenticated;
