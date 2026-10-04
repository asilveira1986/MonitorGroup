-- =====================================================================
-- Indicadores (etapa 3): Demandas e Bloco 2 — Entregas e demandas.
--
-- Uma demanda nasce de 3 formas (cada uma ativável em Configurações):
--   * manual  — "Criar demanda" na conversa ou na tela de Demandas
--   * keyword — comando na mensagem (#demanda, #andamento, #entregue,
--               #cancelada, #prazo) ou palavra-chave do cliente
--   * ai      — classificação automática por IA (desligada por padrão)
-- Toda mudança vira um evento na linha do tempo (demand_events).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações das origens de demanda
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists demand_manual_enabled boolean not null default true;
alter table public.app_settings add column if not exists demand_command_enabled boolean not null default true;
alter table public.app_settings add column if not exists demand_keyword_enabled boolean not null default false;
alter table public.app_settings add column if not exists demand_keywords text[] not null
  default array['solicito', 'preciso de', 'gostaria de solicitar', 'podem enviar', 'favor enviar', 'orçamento'];
alter table public.app_settings add column if not exists demand_ai_enabled boolean not null default false;

-- ---------------------------------------------------------------------
-- Demandas
-- ---------------------------------------------------------------------
create table if not exists public.demands (
  id                      uuid primary key default gen_random_uuid(),
  number                  bigint generated always as identity unique,
  group_id                uuid not null references public.groups(id) on delete cascade,
  origin_message_id       uuid references public.messages(id) on delete set null,
  description             text not null,
  type                    text,
  assignee_id             uuid references public.team_members(id) on delete set null,
  status                  text not null default 'aberta'
                          check (status in ('aberta', 'em_andamento', 'entregue', 'cancelada')),
  opened_at               timestamptz not null default now(),
  promised_at             timestamptz,
  delivered_at            timestamptz,
  confirmed_at            timestamptz,
  confirmation_message_id uuid references public.messages(id) on delete set null,
  followups_count         int not null default 0,
  reopened_count          int not null default 0,
  source                  text not null default 'manual' check (source in ('manual', 'keyword', 'ai')),
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists demands_group_idx on public.demands (group_id, opened_at desc);
create index if not exists demands_status_idx on public.demands (status, opened_at desc);
create index if not exists demands_promised_idx on public.demands (promised_at) where status in ('aberta', 'em_andamento');
create unique index if not exists demands_origin_idx on public.demands (origin_message_id) where origin_message_id is not null;

create table if not exists public.demand_events (
  id           bigint generated always as identity primary key,
  demand_id    uuid not null references public.demands(id) on delete cascade,
  kind         text not null check (kind in ('created', 'status', 'assigned', 'promised', 'edited',
                                             'followup', 'reopened', 'confirmed', 'unconfirmed')),
  from_value   text,
  to_value     text,
  message_id   uuid references public.messages(id) on delete set null,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_label  text,
  created_at   timestamptz not null default now()
);
create index if not exists demand_events_demand_idx on public.demand_events (demand_id, created_at);

-- mensagem ligada a uma demanda (origem, cobrança, entrega, confirmação)
alter table public.messages add column if not exists demand_id uuid references public.demands(id) on delete set null;
create index if not exists messages_demand_idx on public.messages (demand_id) where demand_id is not null;

alter table public.demands enable row level security;
alter table public.demand_events enable row level security;

-- leitura para usuários ativos; escrita só pelas funções abaixo
drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select using (public.is_active_user());
drop policy if exists demand_events_read on public.demand_events;
create policy demand_events_read on public.demand_events for select using (public.is_active_user());

do $$
begin
  begin alter publication supabase_realtime add table public.demands; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Funções (painel: usuário ativo; worker: service_role)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_demands()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_active_user() or coalesce(auth.role(), '') = 'service_role' $$;

create or replace function public.demand_event(
  p_demand uuid, p_kind text, p_from text, p_to text, p_message uuid, p_actor text
) returns void
language sql security definer set search_path = public
as $$
  insert into public.demand_events (demand_id, kind, from_value, to_value, message_id, actor_id, actor_label)
  values (p_demand, p_kind, p_from, p_to, p_message, auth.uid(), p_actor)
$$;

create or replace function public.create_demand(
  p_group_id    uuid,
  p_description text,
  p_message_id  uuid default null,
  p_type        text default null,
  p_assignee_id uuid default null,
  p_promised_at timestamptz default null,
  p_source      text default 'manual',
  p_actor       text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare
  v_d      public.demands%rowtype;
  v_opened timestamptz;
  v_set    public.app_settings%rowtype;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_set from public.app_settings where id = 1;
  if p_source = 'manual' and not v_set.demand_manual_enabled then
    raise exception 'A criação manual de demandas está desativada nas configurações';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Informe a descrição da demanda';
  end if;

  -- mensagem que já originou uma demanda devolve a existente
  if p_message_id is not null then
    select * into v_d from public.demands where origin_message_id = p_message_id;
    if found then return v_d; end if;
    select sent_at into v_opened from public.messages where id = p_message_id and group_id = p_group_id;
  end if;

  insert into public.demands (group_id, origin_message_id, description, type, assignee_id, promised_at,
                              source, opened_at, created_by)
  values (p_group_id, p_message_id, left(trim(p_description), 1000), nullif(trim(p_type), ''), p_assignee_id,
          p_promised_at, p_source, coalesce(v_opened, now()), auth.uid())
  returning * into v_d;

  if p_message_id is not null then
    update public.messages set demand_id = v_d.id where id = p_message_id;
  end if;
  perform public.demand_event(v_d.id, 'created', null, p_source, p_message_id, p_actor);
  if p_promised_at is not null then
    perform public.demand_event(v_d.id, 'promised', null, p_promised_at::text, p_message_id, p_actor);
  end if;
  return v_d;
end;
$$;

-- Altera uma demanda. p_changes aceita: status, assignee_id, promised_at, description, type, confirmed
create or replace function public.update_demand(
  p_id uuid, p_changes jsonb, p_message_id uuid default null, p_actor text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.demands%rowtype;
  v_new public.demands%rowtype;
  v_key text;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('status', 'assignee_id', 'promised_at', 'description', 'type', 'confirmed') then
      raise exception 'Campo % não pode ser alterado', v_key;
    end if;
  end loop;

  select * into v_old from public.demands where id = p_id for update;
  if not found then raise exception 'Demanda não encontrada'; end if;
  v_new := v_old;

  if p_changes ? 'status' and (p_changes->>'status') is distinct from v_old.status then
    v_new.status := p_changes->>'status';
    if v_new.status = 'entregue' then
      v_new.delivered_at := now();
    elsif v_old.status = 'entregue' and v_new.status in ('aberta', 'em_andamento') then
      -- entregue e reaberta = retrabalho
      v_new.reopened_count := v_old.reopened_count + 1;
      v_new.delivered_at := null;
      v_new.confirmed_at := null;
      v_new.confirmation_message_id := null;
      perform public.demand_event(p_id, 'reopened', v_old.status, v_new.status, p_message_id, p_actor);
    end if;
    perform public.demand_event(p_id, 'status', v_old.status, v_new.status, p_message_id, p_actor);
  end if;

  if p_changes ? 'assignee_id' and (p_changes->>'assignee_id')::uuid is distinct from v_old.assignee_id then
    v_new.assignee_id := (p_changes->>'assignee_id')::uuid;
    perform public.demand_event(p_id, 'assigned',
      (select name from public.team_members where id = v_old.assignee_id),
      (select name from public.team_members where id = v_new.assignee_id), p_message_id, p_actor);
  end if;

  if p_changes ? 'promised_at' and (p_changes->>'promised_at')::timestamptz is distinct from v_old.promised_at then
    v_new.promised_at := (p_changes->>'promised_at')::timestamptz;
    perform public.demand_event(p_id, 'promised', v_old.promised_at::text, v_new.promised_at::text, p_message_id, p_actor);
  end if;

  if p_changes ? 'description' and coalesce(trim(p_changes->>'description'), '') <> ''
     and p_changes->>'description' is distinct from v_old.description then
    v_new.description := left(trim(p_changes->>'description'), 1000);
    perform public.demand_event(p_id, 'edited', 'descrição', null, p_message_id, p_actor);
  end if;

  if p_changes ? 'type' and nullif(trim(p_changes->>'type'), '') is distinct from v_old.type then
    v_new.type := nullif(trim(p_changes->>'type'), '');
    perform public.demand_event(p_id, 'edited', v_old.type, v_new.type, p_message_id, p_actor);
  end if;

  if p_changes ? 'confirmed' then
    if (p_changes->>'confirmed')::boolean and v_old.confirmed_at is null then
      v_new.confirmed_at := now();
      v_new.confirmation_message_id := p_message_id;
      perform public.demand_event(p_id, 'confirmed', null, null, p_message_id, p_actor);
    elsif not (p_changes->>'confirmed')::boolean and v_old.confirmed_at is not null then
      v_new.confirmed_at := null;
      v_new.confirmation_message_id := null;
      perform public.demand_event(p_id, 'unconfirmed', null, null, p_message_id, p_actor);
    end if;
  end if;

  update public.demands set
    status = v_new.status, assignee_id = v_new.assignee_id, promised_at = v_new.promised_at,
    description = v_new.description, type = v_new.type, delivered_at = v_new.delivered_at,
    confirmed_at = v_new.confirmed_at, confirmation_message_id = v_new.confirmation_message_id,
    reopened_count = v_new.reopened_count, updated_at = now()
  where id = p_id
  returning * into v_new;

  if p_message_id is not null then
    update public.messages set demand_id = p_id where id = p_message_id and demand_id is null;
  end if;
  return v_new;
end;
$$;

-- Cliente cobrou a demanda (registrado pelo worker ou manualmente)
create or replace function public.register_demand_followup(
  p_id uuid, p_message_id uuid default null, p_actor text default null
)
returns public.demands
language plpgsql security definer set search_path = public
as $$
declare v_d public.demands%rowtype;
begin
  if not public.can_manage_demands() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.demands set followups_count = followups_count + 1, updated_at = now()
  where id = p_id returning * into v_d;
  if not found then raise exception 'Demanda não encontrada'; end if;
  perform public.demand_event(p_id, 'followup', null, v_d.followups_count::text, p_message_id, p_actor);
  if p_message_id is not null then
    update public.messages set demand_id = p_id where id = p_message_id and demand_id is null;
  end if;
  return v_d;
end;
$$;

revoke all on function public.demand_event(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_demand(uuid, text, uuid, text, uuid, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.update_demand(uuid, jsonb, uuid, text) to authenticated, service_role;
grant execute on function public.register_demand_followup(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Indicadores do Bloco 2
-- Filtro de período: demandas abertas no período; atendente = responsável
-- ---------------------------------------------------------------------
create or replace function public.ind_demand_scope(f jsonb)
returns table (
  id uuid, number bigint, group_id uuid, group_name text, description text, type text, assignee text,
  status text, opened_at timestamptz, promised_at timestamptz, delivered_at timestamptz,
  confirmed_at timestamptz, followups_count int, reopened_count int, source text
)
language sql stable set search_path = public
as $$
  select d.id, d.number, d.group_id, g.name, d.description, d.type, tm.name, d.status, d.opened_at,
         d.promised_at, d.delivered_at, d.confirmed_at, d.followups_count, d.reopened_count, d.source
  from public.demands d
  join public.groups g on g.id = d.group_id
  left join public.team_members tm on tm.id = d.assignee_id
  where d.opened_at >= (f->>'from')::timestamptz and d.opened_at < (f->>'to')::timestamptz
    and ((f->>'group_id') is null or d.group_id = (f->>'group_id')::uuid)
    and ((f->>'member_id') is null or d.assignee_id = (f->>'member_id')::uuid)
$$;

-- lista padrão de demandas (filtrada por um critério nomeado)
create or replace function public.ind_demands_list(f jsonb, p_filter text)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'number', 'label', '#', 'format', 'number', 'link_demand', true),
      jsonb_build_object('key', 'opened_at', 'label', 'Aberta em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'description', 'label', 'Demanda'),
      jsonb_build_object('key', 'assignee', 'label', 'Responsável'),
      jsonb_build_object('key', 'status_label', 'label', 'Status'),
      jsonb_build_object('key', 'promised_at', 'label', 'Prazo', 'format', 'datetime'),
      jsonb_build_object('key', 'delivered_at', 'label', 'Entregue em', 'format', 'datetime'),
      jsonb_build_object('key', 'resolution', 'label', 'Resolução', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'followups_count', 'label', 'Cobranças', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'confirmed', 'label', 'Confirmada', 'format', 'text')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'demand_id', id, 'number', number, 'opened_at', opened_at, 'group_id', group_id, 'group_name', group_name,
      'description', left(description, 200), 'assignee', coalesce(assignee, '—'),
      'status_label', case status when 'aberta' then 'Aberta' when 'em_andamento' then 'Em andamento'
                                   when 'entregue' then 'Entregue' else 'Cancelada' end,
      'promised_at', promised_at, 'delivered_at', delivered_at,
      'resolution', case when delivered_at is not null then extract(epoch from delivered_at - opened_at)::int end,
      'followups_count', followups_count,
      'confirmed', case when status <> 'entregue' then '—' when confirmed_at is not null then 'Sim' else 'Não' end
    ) order by opened_at desc), '[]'::jsonb)
  )
  from public.ind_demand_scope(f) d
  where case p_filter
    when 'all' then true
    when 'delivered' then status = 'entregue'
    when 'promised' then promised_at is not null and status <> 'cancelada'
    when 'rework' then reopened_count > 0 or followups_count >= coalesce((f->>'rework_threshold')::int, 2)
    else true end
$$;

create or replace function public.ind_demandas_abertas_concluidas(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f)),
  now_open as (
    select count(*) as n from public.demands x
    where x.status in ('aberta', 'em_andamento')
      and ((f->>'group_id') is null or x.group_id = (f->>'group_id')::uuid)
      and ((f->>'member_id') is null or x.assignee_id = (f->>'member_id')::uuid)
  )
  select jsonb_build_object(
    'visual', 'bars',
    'format', 'number',
    'hint', (select n from now_open) || ' demanda(s) em aberto agora · ' || (select count(*) from d) || ' aberta(s) no período',
    'series', jsonb_build_array(jsonb_build_object('key', 'total', 'label', 'Demandas')),
    'data', jsonb_build_array(
      jsonb_build_object('label', 'Aberta', 'total', (select count(*) from d where status = 'aberta')),
      jsonb_build_object('label', 'Em andamento', 'total', (select count(*) from d where status = 'em_andamento')),
      jsonb_build_object('label', 'Entregue', 'total', (select count(*) from d where status = 'entregue')),
      jsonb_build_object('label', 'Cancelada', 'total', (select count(*) from d where status = 'cancelada'))
    )
  )
$$;

create or replace function public.ind_demandas_abertas_concluidas_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'all') $$;

create or replace function public.ind_tempo_resolucao(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (
    select *, extract(epoch from delivered_at - opened_at)::int as t,
           public.business_seconds(opened_at, delivered_at, f) as tb
    from public.ind_demand_scope(f) where status = 'entregue' and delivered_at is not null
  ),
  agg as (
    select round(avg(t)) as avg_t, round(avg(tb)) as avg_tb,
           percentile_cont(0.5) within group (order by t) as med_t, count(*) as n
    from d
  ),
  trend as (
    select to_char((delivered_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, round(avg(t)) as value
    from d group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'duration',
    'value', agg.avg_t,
    'hint', agg.n || ' demanda(s) entregue(s) · do pedido até a entrega',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Tempo útil', 'value', agg.avg_tb, 'format', 'duration'),
      jsonb_build_object('label', 'Mediana', 'value', round(agg.med_t), 'format', 'duration')
    ),
    'trend', jsonb_build_object('format', 'duration',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from agg
$$;

create or replace function public.ind_tempo_resolucao_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'delivered') $$;

create or replace function public.ind_prazo_prometido_cumprido(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f) where promised_at is not null and status <> 'cancelada'),
  agg as (
    select count(*) filter (where status = 'entregue' and delivered_at <= promised_at) as on_time,
           count(*) filter (where status = 'entregue' and delivered_at > promised_at) as late,
           count(*) filter (where status <> 'entregue' and promised_at < now()) as overdue,
           count(*) filter (where status <> 'entregue' and promised_at >= now()) as running
    from d
  ),
  v as (select *, case when on_time + late + overdue > 0
                       then round(100.0 * on_time / (on_time + late + overdue), 1) end as pct from agg)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', pct,
    'tone', case when pct is null then null when overdue > 0 or pct < 70 then 'critical'
                 when pct < 90 then 'warning' else 'good' end,
    'hint', 'Prazos informados pela equipe e cumpridos',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'No prazo', 'value', on_time, 'format', 'number'),
      jsonb_build_object('label', 'Entregues atrasadas', 'value', late, 'format', 'number'),
      jsonb_build_object('label', 'Vencidas em aberto', 'value', overdue, 'format', 'number'),
      jsonb_build_object('label', 'Dentro do prazo', 'value', running, 'format', 'number')
    )
  )
  from v
$$;

create or replace function public.ind_prazo_prometido_cumprido_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'promised') $$;

create or replace function public.ind_retrabalho(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f)),
  agg as (
    select count(*) as n,
           count(*) filter (where reopened_count > 0) as reopened,
           count(*) filter (where followups_count >= coalesce((p->>'followups_threshold')::int, 2)) as chased,
           count(*) filter (where reopened_count > 0
                            or followups_count >= coalesce((p->>'followups_threshold')::int, 2)) as rework
    from d
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', rework,
    'tone', case when n = 0 then null when rework = 0 then 'good'
                 when 100.0 * rework / n < 15 then 'warning' else 'critical' end,
    'hint', case when n = 0 then 'Nenhuma demanda no período'
                 else round(100.0 * rework / n, 1) || '% das ' || n || ' demandas do período' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Reabertas', 'value', reopened, 'format', 'number'),
      jsonb_build_object('label', 'Cobradas ' || coalesce(p->>'followups_threshold', '2') || '+ vezes', 'value', chased, 'format', 'number')
    )
  )
  from agg
$$;

create or replace function public.ind_retrabalho_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f || jsonb_build_object('rework_threshold', coalesce((p->>'followups_threshold')::int, 2)), 'rework') $$;

create or replace function public.ind_confirmacao_cliente(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with d as (select * from public.ind_demand_scope(f) where status = 'entregue'),
  agg as (select count(*) as n, count(*) filter (where confirmed_at is not null) as ok from d)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'percent',
    'value', case when n > 0 then round(100.0 * ok / n, 1) end,
    'hint', ok || ' de ' || n || ' entrega(s) confirmada(s) pelo cliente',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Com confirmação', 'value', ok, 'format', 'number'),
      jsonb_build_object('label', 'Sem confirmação', 'value', n - ok, 'format', 'number')
    )
  )
  from agg
$$;

create or replace function public.ind_confirmacao_cliente_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_demands_list(f, 'delivered') $$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('demandas_abertas_concluidas', 'entregas_demandas', 'Demandas por status',
   'Demandas abertas no período por status: aberta, em andamento, entregue e cancelada.', 1, 'bars', 2, false, false,
   '{}', '[]'),
  ('tempo_resolucao', 'entregas_demandas', 'Tempo de resolução',
   'Tempo entre o pedido do cliente e a entrega.', 2, 'kpi', 1, false, false,
   '{}', '[]'),
  ('prazo_prometido_cumprido', 'entregas_demandas', 'Prazos cumpridos',
   'Prazos informados pela equipe e se foram cumpridos.', 3, 'kpi', 1, true, true,
   '{}', '[]'),
  ('retrabalho', 'entregas_demandas', 'Retrabalho',
   'Demandas reabertas ou cobradas pelo cliente mais de uma vez.', 4, 'kpi', 1, true, false,
   '{"followups_threshold": 2, "followup_keywords": ["alguma novidade", "e aí", "cadê", "ainda não", "até quando", "previsão", "aguardando", "novidades", "conseguiram ver", "tem retorno"], "reopen_keywords": ["não funcionou", "nao funcionou", "continua", "de novo", "voltou a", "ainda está", "não resolveu", "deu erro"]}',
   '[{"key":"followups_threshold","label":"Cobranças para contar como retrabalho","type":"int","min":1,"max":20},{"key":"followup_keywords","label":"Palavras que indicam cobrança","type":"tags","help":"Mensagem do cliente com uma destas palavras, num grupo com demanda em aberto, conta como cobrança."},{"key":"reopen_keywords","label":"Palavras que reabrem uma entrega","type":"tags","help":"Mensagem do cliente com uma destas palavras logo após uma entrega reabre a demanda."}]'),
  ('confirmacao_cliente', 'entregas_demandas', 'Confirmação do cliente',
   'Entregas com e sem confirmação de recebimento do cliente.', 5, 'kpi', 1, false, false,
   '{"confirm_keywords": ["recebi", "recebido", "deu certo", "funcionou", "confirmado", "chegou", "perfeito, obrigado", "resolvido"], "confirm_window_days": 7}',
   '[{"key":"confirm_keywords","label":"Palavras de confirmação","type":"tags","help":"Mensagem do cliente com uma destas palavras confirma a última entrega do grupo."},{"key":"confirm_window_days","label":"Prazo para confirmar","type":"int","unit":"dias","min":1,"max":60}]')
on conflict (key) do nothing;

update public.indicators set params = default_params, enabled = default_enabled, alert_enabled = default_alert_enabled
where block_key = 'entregas_demandas' and updated_by is null and params = '{}'::jsonb and default_params <> '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Alertas ligados aos novos indicadores
-- ---------------------------------------------------------------------
alter table public.alert_rules drop constraint if exists alert_rules_type_check;
alter table public.alert_rules add constraint alert_rules_type_check
  check (type in ('no_response', 'keyword', 'high_volume', 'disconnected', 'inactivity', 'deadline_missed', 'rework'));

insert into public.alert_rules (name, type, severity, cooldown_minutes, indicator_key)
select 'Prazo prometido vencido', 'deadline_missed', 'critical', 60, 'prazo_prometido_cumprido'
where not exists (select 1 from public.alert_rules where type = 'deadline_missed');
insert into public.alert_rules (name, type, severity, cooldown_minutes, indicator_key)
select 'Demanda com retrabalho', 'rework', 'warning', 60, 'retrabalho'
where not exists (select 1 from public.alert_rules where type = 'rework');

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

-- alerta ligado a uma demanda (prazo vencido, retrabalho)
alter table public.alerts add column if not exists demand_id uuid references public.demands(id) on delete cascade;
create index if not exists alerts_demand_idx on public.alerts (demand_id) where demand_id is not null;
