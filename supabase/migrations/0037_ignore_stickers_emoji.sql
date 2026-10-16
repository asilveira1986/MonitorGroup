-- =====================================================================
-- Desconsiderar figurinha / emoji como última mensagem do cliente.
--
-- Com a opção ligada (Configurações › Geral), a figurinha ou a mensagem só
-- com emojis (👍, 🙏, 😊 ...) que o cliente manda:
--  * fica gravada e aparece na conversa;
--  * não abre pendência nem aumenta a fila de "sem resposta";
--  * não vira a "última mensagem do cliente" (prévia do grupo, horário da
--    última mensagem do cliente e início da contagem do tempo de resposta);
--  * não gera aviso em tela/voz de mensagem nova.
-- A detecção é feita pelo worker, que informa p_ignored_as_last.
-- =====================================================================

alter table public.app_settings
  add column if not exists ignore_stickers_emoji boolean not null default true;

alter table public.messages
  add column if not exists ignored_as_last boolean not null default false;

-- a versão anterior (12 parâmetros) é trocada pela nova; o último parâmetro
-- tem padrão, então chamadas sem ele continuam funcionando
drop function if exists public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean);

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
  p_ignored_as_last boolean default false  -- figurinha/emoji desconsiderado
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
begin
  -- trava o grupo para evitar condições de corrida
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id;
  end if;

  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name,
    from_me, from_team, team_member_id, message_type, body, sent_at, opens_pending, ignored_as_last
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at,
    coalesce(p_opens_pending, true) and not v_ignored, v_ignored
  )
  on conflict (group_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('inserted', false);
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

comment on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean, boolean)
  is 'Desconsidera figurinha/emoji como última mensagem do cliente (0037)';

revoke all on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean, boolean)
  to service_role;

-- Recálculo após importar o histórico, com a mesma regra
create or replace function public.rebuild_group_state(p_group_id uuid, p_live_since timestamptz default now())
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_msg             record;
  v_pending_since   timestamptz;
  v_pending_msg     uuid;
  v_pending_count   int := 0;
  v_last            record;
  v_last_client     timestamptz;
  v_last_team       timestamptz;
  v_resp            int;
  v_answered        uuid;
  v_last_pending_at  timestamptz;
  v_last_pending_msg uuid;
begin
  perform 1 from public.groups where id = p_group_id for update;

  for v_msg in
    select id, from_team, opens_pending, sent_at, response_time_seconds, answered_message_id
    from public.messages where group_id = p_group_id and not ignored_as_last order by sent_at, created_at
  loop
    if v_msg.from_team then
      v_last_team := v_msg.sent_at;
      if v_pending_since is not null then
        v_resp := greatest(0, extract(epoch from (v_msg.sent_at - v_last_pending_at))::int);
        v_answered := v_last_pending_msg;
      else
        v_resp := null;
        v_answered := null;
      end if;
      if v_msg.response_time_seconds is distinct from v_resp or v_msg.answered_message_id is distinct from v_answered then
        update public.messages set response_time_seconds = v_resp, answered_message_id = v_answered where id = v_msg.id;
      end if;
      v_pending_since := null;
      v_pending_msg := null;
      v_pending_count := 0;
    else
      v_last_client := v_msg.sent_at;
      if v_msg.opens_pending or v_pending_since is not null then
        v_last_pending_at := v_msg.sent_at;
        v_last_pending_msg := v_msg.id;
        v_pending_since := coalesce(v_pending_since, v_msg.sent_at);
        v_pending_msg := coalesce(v_pending_msg, v_msg.id);
        v_pending_count := v_pending_count + 1;
      end if;
    end if;
  end loop;

  -- pendências antigas vindas do histórico (anteriores à conexão) provavelmente
  -- foram resolvidas por outro canal: só ficam na fila as das últimas 24 horas
  if v_pending_since is not null
     and v_pending_since < p_live_since
     and v_pending_since < now() - interval '24 hours' then
    select min(sent_at), (array_agg(id order by sent_at))[1], count(*)
      into v_pending_since, v_pending_msg, v_pending_count
    from public.messages
    where group_id = p_group_id and not from_team and opens_pending and not ignored_as_last
      and sent_at >= now() - interval '24 hours'
      and sent_at > coalesce(v_last_team, '-infinity'::timestamptz);
    if v_pending_count = 0 then
      v_pending_since := null;
      v_pending_msg := null;
    end if;
  end if;

  select sent_at, sender_name, body, message_type into v_last
  from public.messages where group_id = p_group_id and not ignored_as_last
  order by sent_at desc, created_at desc limit 1;

  update public.groups set
    pending_since = v_pending_since,
    pending_message_id = v_pending_msg,
    pending_count = v_pending_count,
    last_message_at = v_last.sent_at,
    last_client_message_at = v_last_client,
    last_team_message_at = v_last_team,
    last_message_preview = case when v_last.sent_at is null then null
      else left(coalesce(v_last.sender_name || ': ', '') || coalesce(v_last.body, '[' || v_last.message_type || ']'), 160) end
  where id = p_group_id;
end;
$$;

revoke all on function public.rebuild_group_state(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rebuild_group_state(uuid, timestamptz) to service_role;
