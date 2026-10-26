-- =====================================================================
-- Notificações push no celular e no computador (Web Push).
--
--  * Cada aparelho em que o usuário ativa as notificações grava a sua
--    assinatura (push_subscriptions). No iPhone, só com o sistema
--    adicionado à Tela de Início (iOS 16.4 ou mais novo).
--  * Os avisos entram em push_events (pelos gatilhos abaixo e pelos
--    lembretes que o worker agenda) e o worker os envia: alertas dos
--    grupos, demandas atribuídas / vencendo / atrasadas, compromissos da
--    agenda e mensagens novas nas conversas privadas.
--  * Quem recebe segue as mesmas regras de acesso do painel: o worker
--    confere, por usuário, se ele vê o grupo (visible_group_ids) ou as
--    conversas privadas (can_use_private_chats).
--  * As chaves de envio (VAPID) são geradas pelo próprio worker na
--    primeira vez e ficam só com a chave de serviço; o painel lê apenas a
--    chave pública.
--  * Cada usuário escolhe no perfil quais avisos quer (profiles.push_prefs).
-- =====================================================================

-- chaves de envio (uma linha só)
create table if not exists public.push_config (
  id          smallint primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  subject     text not null default 'mailto:suporte@monitorgroup.app',
  created_at  timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select public_key from public.push_config where id = 1 and public.is_active_user()
$$;
grant execute on function public.push_public_key() to authenticated;

-- aparelhos que recebem
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  failures    int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_read on public.push_subscriptions;
create policy push_subscriptions_read on public.push_subscriptions for select using (user_id = (select auth.uid()));
grant select on public.push_subscriptions to authenticated;

-- quais avisos o usuário quer (vazio = todos): {"alert":true,"demand":true,"agenda":true,"private":true}
alter table public.profiles add column if not exists push_prefs jsonb not null default '{}'::jsonb;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then
    raise exception 'Usuário sem acesso.' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Assinatura de notificação inválida.';
  end if;
  -- o mesmo aparelho passa para quem entrou nele agora
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0;
end;
$$;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.set_push_prefs(p_prefs jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
begin
  foreach k in array array['alert', 'demand', 'agenda', 'private'] loop
    if jsonb_typeof(p_prefs -> k) = 'boolean' then
      v := v || jsonb_build_object(k, p_prefs -> k);
    end if;
  end loop;
  update public.profiles set push_prefs = v where id = auth.uid();
end;
$$;
grant execute on function public.set_push_prefs(jsonb) to authenticated;

-- fila de avisos
--   audience: group (quem vê o grupo), admins (administradores da empresa),
--             private (quem usa as conversas privadas), users (target_users)
create table if not exists public.push_events (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null check (kind in ('alert', 'demand', 'agenda', 'private', 'test')),
  audience     text not null check (audience in ('group', 'admins', 'private', 'users')),
  group_id     uuid references public.groups(id) on delete cascade,
  target_users uuid[] not null default '{}',
  actor_id     uuid,
  title        text not null,
  body         text,
  url          text not null default '/',
  tag          text,
  dedupe_key   text unique,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists push_events_pending_idx on public.push_events (id) where processed_at is null;
alter table public.push_events enable row level security;
revoke all on public.push_events from anon, authenticated;

create or replace function public.queue_push(
  p_company uuid, p_kind text, p_audience text, p_title text, p_body text, p_url text,
  p_group uuid default null, p_users uuid[] default '{}', p_tag text default null, p_dedupe text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_company is null or nullif(btrim(coalesce(p_title, '')), '') is null then
    return;
  end if;
  if p_audience = 'users' and cardinality(coalesce(p_users, '{}')) = 0 then
    return;
  end if;
  -- só se alguém da empresa tem aparelho cadastrado (não enche a fila à toa)
  if not exists (select 1 from public.push_subscriptions s join public.profiles p on p.id = s.user_id
                  where p.company_id = p_company and p.active) then
    return;
  end if;
  insert into public.push_events (company_id, kind, audience, group_id, target_users, actor_id, title, body, url, tag, dedupe_key)
  values (p_company, p_kind, p_audience, p_group, coalesce(p_users, '{}'), auth.uid(),
          left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_body, '')), 240), ''), coalesce(p_url, '/'), p_tag, p_dedupe)
  on conflict (dedupe_key) do nothing;
exception when others then
  -- o aviso nunca impede a gravação que o originou
  raise warning 'aviso push não entrou na fila: %', sqlerrm;
end;
$$;
revoke all on function public.queue_push(uuid, text, text, text, text, text, uuid, uuid[], text, text) from public, anon, authenticated;

-- usuários ligados a uma pessoa da equipe (pelo e-mail)
create or replace function public.team_member_user_ids(p_member uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}')
    from public.team_members t
    join public.profiles p on lower(p.email) = lower(t.user_email) and p.company_id = t.company_id and p.active
   where t.id = p_member
$$;
revoke all on function public.team_member_user_ids(uuid) from public, anon, authenticated;

-- ------------------------------------------------ gatilhos
-- alerta novo (os que a regra mostra no painel)
create or replace function public.alerts_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := coalesce(new.company_id, (select company_id from public.groups where id = new.group_id));
  v_group text;
begin
  if new.rule_id is not null and not coalesce((select notify_in_app from public.alert_rules where id = new.rule_id), true) then
    return new;
  end if;
  select name into v_group from public.groups where id = new.group_id;
  perform public.queue_push(
    v_company, 'alert', case when new.group_id is null then 'admins' else 'group' end,
    case when new.severity = 'critical' then '🚨 ' else '⚠️ ' end || new.title,
    concat_ws(' · ', v_group, nullif(left(coalesce(new.description, ''), 160), '')),
    case when new.group_id is null then '/alerts' else '/groups/' || new.group_id end,
    new.group_id, '{}', 'alert:' || coalesce(new.group_id::text, new.id::text));
  return new;
end;
$$;
drop trigger if exists alerts_push on public.alerts;
create trigger alerts_push after insert on public.alerts for each row execute function public.alerts_push();

-- demanda atribuída a alguém (nova ou trocou de responsável)
create or replace function public.demands_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_group text;
begin
  if new.assignee_id is null or new.status not in ('aberta', 'em_andamento')
     or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id) then
    return new;
  end if;
  v_users := array(select u from unnest(public.team_member_user_ids(new.assignee_id)) u where u is distinct from auth.uid());
  select name into v_group from public.groups where id = new.group_id;
  perform public.queue_push(
    new.company_id, 'demand', 'users',
    '📋 Nova demanda para você' || coalesce(' (nº ' || new.number || ')', ''),
    concat_ws(' · ', v_group, left(coalesce(new.description, ''), 160)),
    '/demands', null, v_users, 'demand:' || new.id);
  return new;
end;
$$;
drop trigger if exists demands_push on public.demands;
create trigger demands_push after insert or update of assignee_id on public.demands
  for each row execute function public.demands_push();

-- colocado num compromisso por outra pessoa
create or replace function public.agenda_people_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
  v_tz text;
begin
  if new.user_id = auth.uid() then
    return new;
  end if;
  select * into e from public.agenda_events where id = new.event_id;
  if e.id is null or e.done_at is not null or e.starts_at < now() - interval '1 day' then
    return new;
  end if;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = e.company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  perform public.queue_push(
    e.company_id, 'agenda', 'users', '📅 Novo compromisso na sua agenda',
    e.title || ' · ' || to_char(e.starts_at at time zone v_tz, case when e.all_day then 'DD/MM' else 'DD/MM "às" HH24:MI' end),
    '/agenda', null, array[new.user_id], 'agenda:' || e.id);
  return new;
end;
$$;
drop trigger if exists agenda_people_push on public.agenda_event_people;
create trigger agenda_people_push after insert on public.agenda_event_people
  for each row execute function public.agenda_people_push();

-- mensagem nova de cliente no privado (as antigas, que chegam na sincronização, não avisam)
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
begin
  if new.from_me or new.sent_at < now() - interval '10 minutes' then
    return new;
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not coalesce((select private_chats_enabled from public.companies where id = new.company_id), false) then
    return new;
  end if;
  perform public.queue_push(
    new.company_id, 'private', 'private',
    '💬 ' || coalesce(nullif(btrim(c.name), ''), nullif(btrim(new.sender_name), ''), c.phone, 'Conversa privada'),
    case new.message_type when 'text' then left(coalesce(new.body, ''), 160)
                          when 'audio' then '🎤 Áudio' when 'image' then '📷 Imagem'
                          when 'document' then '📄 Documento' when 'video' then '🎬 Vídeo'
                          else coalesce(left(new.body, 160), 'Nova mensagem') end,
    '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  return new;
end;
$$;
drop trigger if exists private_messages_push on public.private_messages;
create trigger private_messages_push after insert on public.private_messages
  for each row execute function public.private_messages_push();

-- ------------------------------------------------ lembretes (o worker chama a cada minuto)
create or replace function public.queue_scheduled_pushes()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
begin
  -- compromissos que começam nos próximos 15 minutos
  for r in
    select e.*, coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo') as tz
      from public.agenda_events e
      left join public.app_settings s on s.company_id = e.company_id
     where e.done_at is null and not e.all_day
       and e.starts_at > now() and e.starts_at <= now() + interval '15 minutes'
  loop
    perform public.queue_push(
      r.company_id, 'agenda', 'users', '⏰ Compromisso às ' || to_char(r.starts_at at time zone r.tz, 'HH24:MI'),
      r.title, '/agenda', null,
      array(select x.user_id from public.agenda_event_people x where x.event_id = r.id
            union select unnest(public.team_member_user_ids(r.member_id)) where r.member_id is not null),
      'agenda:' || r.id, 'agenda-soon:' || r.id || ':' || r.starts_at);
    v_count := v_count + 1;
  end loop;

  -- demandas que vencem na próxima hora
  for r in
    select d.*, g.name as group_name, coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo') as tz
      from public.demands d
      left join public.groups g on g.id = d.group_id
      left join public.app_settings s on s.company_id = d.company_id
     where d.status in ('aberta', 'em_andamento') and d.assignee_id is not null
       and d.promised_at > now() and d.promised_at <= now() + interval '1 hour'
  loop
    perform public.queue_push(
      r.company_id, 'demand', 'users',
      '⏳ Demanda vence às ' || to_char(r.promised_at at time zone r.tz, 'HH24:MI') || coalesce(' (nº ' || r.number || ')', ''),
      concat_ws(' · ', r.group_name, left(coalesce(r.description, ''), 160)), '/demands', null,
      public.team_member_user_ids(r.assignee_id), 'demand:' || r.id, 'demand-soon:' || r.id || ':' || r.promised_at);
    v_count := v_count + 1;
  end loop;

  -- demandas que acabaram de atrasar (até 1 dia; um aviso por prazo)
  for r in
    select d.*, g.name as group_name
      from public.demands d
      left join public.groups g on g.id = d.group_id
     where d.status in ('aberta', 'em_andamento') and d.assignee_id is not null
       and d.promised_at <= now() and d.promised_at > now() - interval '1 day'
  loop
    perform public.queue_push(
      r.company_id, 'demand', 'users', '🔴 Demanda atrasada' || coalesce(' (nº ' || r.number || ')', ''),
      concat_ws(' · ', r.group_name, left(coalesce(r.description, ''), 160)), '/demands', null,
      public.team_member_user_ids(r.assignee_id), 'demand:' || r.id, 'demand-late:' || r.id || ':' || r.promised_at);
    v_count := v_count + 1;
  end loop;

  -- limpeza: avisos enviados há mais de 7 dias
  delete from public.push_events where processed_at < now() - interval '7 days';
  return v_count;
end;
$$;
revoke all on function public.queue_scheduled_pushes() from public, anon, authenticated;
grant execute on function public.queue_scheduled_pushes() to service_role;

-- ------------------------------------------------ envio (worker)
-- pega os avisos pendentes, decide quem recebe (com as regras de acesso de cada usuário) e devolve
-- um item por aparelho
create or replace function public.claim_push_deliveries(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.push_events%rowtype;
  u record;
  v_out jsonb := '[]'::jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_ok boolean;
begin
  for ev in
    select * from public.push_events where processed_at is null order by id limit greatest(1, least(p_limit, 200))
    for update skip locked
  loop
    for u in
      select p.id
        from public.profiles p
       where p.company_id = ev.company_id and p.active
         and (p.id <> ev.actor_id or ev.actor_id is null or ev.kind = 'test')
         and coalesce((p.push_prefs ->> case when ev.kind = 'test' then 'none' else ev.kind end)::boolean, true)
         and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
         and (ev.audience <> 'users' or p.id = any(ev.target_users))
    loop
      if ev.audience = 'users' then
        v_ok := true;
      else
        -- confere como se fosse o próprio usuário logado
        perform set_config('request.jwt.claim.sub', u.id::text, true);
        perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        v_ok := case ev.audience
          when 'group' then ev.group_id = any(public.visible_group_ids())
          when 'admins' then public.is_admin()
          when 'private' then public.can_use_private_chats()
          else false end;
        perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      end if;
      if v_ok then
        v_out := v_out || coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subscription_id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                   'payload', jsonb_build_object('title', ev.title, 'body', ev.body, 'url', ev.url,
                                                 'tag', coalesce(ev.tag, ev.kind || ':' || ev.id))))
            from public.push_subscriptions s where s.user_id = u.id), '[]'::jsonb);
      end if;
    end loop;
    update public.push_events set processed_at = now() where id = ev.id;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.claim_push_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(int) to service_role;

-- resultado do envio: aparelho que saiu (404/410) é apagado; falhas seguidas também
create or replace function public.push_delivery_result(p_subscription uuid, p_ok boolean, p_gone boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_gone then
    delete from public.push_subscriptions where id = p_subscription;
  elsif p_ok then
    update public.push_subscriptions set last_ok_at = now(), failures = 0 where id = p_subscription;
  else
    update public.push_subscriptions set failures = failures + 1 where id = p_subscription;
    delete from public.push_subscriptions where id = p_subscription and failures >= 20;
  end if;
end;
$$;
revoke all on function public.push_delivery_result(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.push_delivery_result(uuid, boolean, boolean) to service_role;

-- botão "Enviar teste" do perfil
create or replace function public.push_test()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    raise exception 'Ative as notificações neste aparelho primeiro.';
  end if;
  insert into public.push_events (company_id, kind, audience, target_users, actor_id, title, body, url, tag)
  values (public.current_company_id(), 'test', 'users', array[auth.uid()], auth.uid(),
          '🔔 Notificações ativadas', 'Você vai receber os avisos do MonitorGroup neste aparelho.', '/dashboard', 'test');
end;
$$;
grant execute on function public.push_test() to authenticated;
