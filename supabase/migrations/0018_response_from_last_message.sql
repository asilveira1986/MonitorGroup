-- =====================================================================
-- Tempo de resposta contado a partir da ÚLTIMA mensagem do cliente.
--
-- Antes: quando o cliente mandava várias mensagens seguidas, o tempo era
-- medido desde a primeira delas. Agora vale a última mensagem do cliente
-- antes da resposta da equipe (é a que foi de fato respondida).
-- A pendência (fila de "sem resposta" e alertas) continua contando desde a
-- primeira mensagem, porque o cliente está esperando desde ela.
-- Os tempos já gravados são recalculados no fim deste script.
-- O detalhamento dos indicadores de resposta passa a vir agrupado por grupo.
-- =====================================================================

-- Mesma função de antes (0007), mudando só o início da contagem
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
  v_last_client timestamptz;
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
      -- tempo desde a última mensagem do cliente antes desta resposta
      select id, sent_at into v_answered, v_last_client
      from public.messages
      where group_id = p_group_id and not from_team and sent_at <= p_sent_at and sent_at >= v_group.pending_since
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

comment on function public.ingest_message(uuid, text, text, text, text, boolean, boolean, uuid, text, text, timestamptz, boolean)
  is 'Tempo de resposta desde a última mensagem do cliente (0018)';

-- Recálculo do histórico com a mesma regra
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
  v_last_pending_at  timestamptz;
  v_last_pending_msg uuid;
begin
  perform 1 from public.groups where id = p_group_id for update;

  for v_msg in
    select id, from_team, opens_pending, sent_at, response_time_seconds, answered_message_id
    from public.messages where group_id = p_group_id order by sent_at, created_at
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

-- ---------------------------------------------------------------------
-- Recalcula os tempos já gravados: última mensagem do cliente antes de
-- cada resposta (entre a resposta anterior da equipe e esta). Respostas sem
-- mensagem do cliente nesse intervalo ficam como estavam.
-- ---------------------------------------------------------------------
update public.messages r
set response_time_seconds = x.secs, answered_message_id = x.cid
from (
  select t.id, c.id as cid, greatest(0, extract(epoch from (t.sent_at - c.sent_at))::int) as secs
  from public.messages t
  cross join lateral (
    select q.id, q.sent_at from public.messages q
    where q.group_id = t.group_id and not q.from_team and q.sent_at <= t.sent_at
      -- só as mensagens depois da resposta anterior da equipe
      and q.sent_at > coalesce((select max(e.sent_at) from public.messages e
                                where e.group_id = t.group_id and e.from_team and e.sent_at < t.sent_at), '-infinity')
    order by q.sent_at desc, q.created_at desc limit 1
  ) c
  where t.from_team and t.response_time_seconds is not null
) x
where r.id = x.id
  and (r.answered_message_id is distinct from x.cid or r.response_time_seconds is distinct from x.secs);

-- ---------------------------------------------------------------------
-- Detalhamento das respostas agrupado por grupo: cada grupo vira um
-- cabeçalho com a quantidade de respostas, os tempos médios e o SLA.
-- ---------------------------------------------------------------------
create or replace function public.ind_responses_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with o as (select public.sla_business_time_only() as useful)
  select jsonb_build_object(
    'group_by', jsonb_build_object('key', 'group_id', 'label', 'group_name', 'noun', jsonb_build_array('resposta', 'respostas')),
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'asked_at', 'label', 'Última msg. do cliente', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'question', 'label', 'Mensagem do cliente'),
      jsonb_build_object('key', 'responder', 'label', 'Respondido por'),
      jsonb_build_object('key', 'shift', 'label', 'Chegou', 'format', 'text'),
      jsonb_build_object('key', 'response_time_seconds', 'label', 'Tempo corrido', 'format', 'duration', 'align', 'right', 'summary', 'avg'),
      jsonb_build_object('key', 'business_seconds', 'label', 'Tempo útil', 'format', 'duration', 'align', 'right', 'summary', 'avg'),
      jsonb_build_object('key', 'in_sla', 'label', 'No SLA', 'format', 'text', 'summary', 'share', 'summary_match', 'Sim')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'asked_at', asked_at, 'group_id', group_id, 'group_name', group_name, 'client_name', client_name,
      'question', left(coalesce(question, '[mídia]'), 200), 'responder', responder,
      'shift', case when asked_in_business then 'No expediente' else 'Fora do expediente' end,
      'response_time_seconds', response_time_seconds, 'business_seconds', business_seconds,
      'in_sla', case when (case when o.useful then business_seconds else response_time_seconds end) <= sla_seconds
                     then 'Sim' else 'Não' end
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_responses(f) order by sent_at desc limit 500) x, o
$$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
