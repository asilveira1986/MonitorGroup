-- =====================================================================
-- Importação do histórico dos grupos.
--
-- Ao ler o QR code, o WhatsApp envia as mensagens recentes. O worker
-- importa as dos últimos N dias (configurável) em lotes e, no fim,
-- recalcula de uma vez os tempos de resposta e a situação de cada grupo.
-- =====================================================================

-- Quantos dias de histórico importar ao conectar (0 = não importar)
alter table public.app_settings
  add column if not exists history_import_days int not null default 30
  check (history_import_days in (0, 7, 30, 60, 90));

-- Progresso da importação, exibido no painel
alter table public.whatsapp_instances add column if not exists history_status text not null default 'idle'
  check (history_status in ('idle', 'importing', 'done'));
alter table public.whatsapp_instances add column if not exists history_imported int not null default 0;
alter table public.whatsapp_instances add column if not exists history_started_at timestamptz;
alter table public.whatsapp_instances add column if not exists history_finished_at timestamptz;

-- Novo comando do painel: reconectar para receber o histórico de novo
alter table public.whatsapp_instances drop constraint if exists whatsapp_instances_requested_action_check;
alter table public.whatsapp_instances add constraint whatsapp_instances_requested_action_check
  check (requested_action in ('connect', 'logout', 'reimport'));

-- Guarda se a mensagem do cliente exige resposta ("ok", "obrigado" não exigem),
-- para o recálculo do histórico seguir a mesma regra do tempo real.
alter table public.messages add column if not exists opens_pending boolean not null default true;

-- Mesma função de antes, agora gravando opens_pending
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
    from_me, from_team, team_member_id, message_type, body, sent_at, opens_pending
  ) values (
    p_group_id, p_wa_message_id, p_sender_jid, p_sender_phone, p_sender_name,
    p_from_me, p_from_team, p_team_member_id, p_message_type, p_body, p_sent_at,
    coalesce(p_opens_pending, true)
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

-- Recalcula, em ordem cronológica, os tempos de resposta e a situação atual
-- do grupo (usado após importar o histórico).
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
begin
  perform 1 from public.groups where id = p_group_id for update;

  for v_msg in
    select id, from_team, opens_pending, sent_at, response_time_seconds, answered_message_id
    from public.messages where group_id = p_group_id order by sent_at, created_at
  loop
    if v_msg.from_team then
      v_last_team := v_msg.sent_at;
      if v_pending_since is not null then
        v_resp := greatest(0, extract(epoch from (v_msg.sent_at - v_pending_since))::int);
        v_answered := v_pending_msg;
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
    -- recomeça a contagem pelas mensagens de cliente das últimas 24 horas (se houver)
    select min(sent_at), (array_agg(id order by sent_at))[1], count(*)
      into v_pending_since, v_pending_msg, v_pending_count
    from public.messages
    where group_id = p_group_id and not from_team and opens_pending
      and sent_at >= now() - interval '24 hours'
      and sent_at > coalesce(v_last_team, '-infinity'::timestamptz);
    if v_pending_count = 0 then
      v_pending_since := null;
      v_pending_msg := null;
    end if;
  end if;

  select sent_at, sender_name, body, message_type into v_last
  from public.messages where group_id = p_group_id order by sent_at desc, created_at desc limit 1;

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

-- Indicadores da tela do grupo calculados no banco (em vez de baixar as mensagens)
create or replace function public.group_stats(p_group_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_sla    int;
  v_result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;

  select coalesce(g.sla_minutes, s.default_sla_minutes) * 60 into v_sla
  from public.groups g cross join public.app_settings s
  where g.id = p_group_id;

  select jsonb_build_object(
    'received', count(*) filter (where not from_team),
    'sent', count(*) filter (where from_team),
    'responses', count(response_time_seconds),
    'avg_response_seconds', round(avg(response_time_seconds)),
    'in_sla', count(*) filter (where response_time_seconds <= v_sla),
    'sla_seconds', v_sla
  ) into v_result
  from public.messages
  where group_id = p_group_id and sent_at >= now() - make_interval(days => p_days);

  return v_result;
end;
$$;

grant execute on function public.group_stats(uuid, int) to authenticated;
