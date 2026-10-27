-- =====================================================================
-- Agenda: tipos de compromisso (com cor) e compromissos que se repetem.
--
--  * agenda_event_types: tipos da empresa (Reunião, Audiência, Prazo...),
--    cada um com uma cor; o administrador cria e edita em Configurações ›
--    Tipos de compromisso. Cada compromisso pode ter um tipo e aparece na
--    agenda com a cor dele.
--  * agenda_series: a regra de repetição (todo dia, toda semana em certos
--    dias, todo mês, todo ano; a cada N; até uma data, N vezes ou sem fim).
--    Cada ocorrência é um compromisso de verdade (lembretes, participantes
--    e concluir valem para cada uma). Sem fim: o sistema mantém sempre
--    12 meses à frente (o worker estende a cada minuto, junto com os
--    lembretes).
--  * Editar ou excluir uma ocorrência: "só este" ou "este e os próximos".
--  * Corrige o aviso "novo compromisso na sua agenda", que o script 0101
--    tinha desligado.
-- =====================================================================

-- ------------------------------------------------ tipos
create table if not exists public.agenda_event_types (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  color      text not null default 'blue'
             check (color in ('blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow', 'gray')),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.agenda_event_types enable row level security;
drop policy if exists agenda_event_types_read on public.agenda_event_types;
create policy agenda_event_types_read on public.agenda_event_types for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
drop policy if exists agenda_event_types_write on public.agenda_event_types;
create policy agenda_event_types_write on public.agenda_event_types for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));
grant select, insert, update, delete on public.agenda_event_types to authenticated;

-- tipos iniciais de cada empresa (o administrador muda à vontade)
create or replace function public.agenda_types_seed(p_company uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.agenda_event_types (company_id, name, color, position)
  select p_company, t.name, t.color, t.pos
    from (values ('Reunião', 'blue', 1), ('Audiência', 'red', 2), ('Prazo', 'orange', 3),
                 ('Ligação', 'green', 4), ('Visita', 'purple', 5), ('Pessoal', 'gray', 6)) t(name, color, pos)
   where not exists (select 1 from public.agenda_event_types x where x.company_id = p_company)
  on conflict do nothing
$$;
revoke all on function public.agenda_types_seed(uuid) from public, anon, authenticated;
do $seed$ begin perform public.agenda_types_seed(id) from public.companies; end $seed$;

create or replace function public.companies_seed_agenda_types()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.agenda_types_seed(new.id);
  return new;
end;
$$;
drop trigger if exists companies_seed_agenda_types on public.companies;
create trigger companies_seed_agenda_types after insert on public.companies
  for each row execute function public.companies_seed_agenda_types();

-- ------------------------------------------------ séries (repetição)
create table if not exists public.agenda_series (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  freq            text not null check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  every           int not null default 1 check (every between 1 and 99),
  weekdays        int[] not null default '{}',
  until           date,
  count           int check (count between 2 and 500),
  tz              text not null default 'America/Sao_Paulo',
  -- primeira ocorrência e a última já criada, no horário local
  anchor          timestamp not null,
  generated_until timestamp not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.agenda_series enable row level security;
drop policy if exists agenda_series_read on public.agenda_series;
create policy agenda_series_read on public.agenda_series for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
grant select on public.agenda_series to authenticated;

alter table public.agenda_events
  add column if not exists type_id uuid references public.agenda_event_types(id) on delete set null,
  add column if not exists series_id uuid references public.agenda_series(id) on delete set null;
create index if not exists agenda_events_series_idx on public.agenda_events (series_id, starts_at) where series_id is not null;

-- regra informada pelo painel, conferida: {"freq","every","weekdays","until","count"}; null = não repete
create or replace function public.agenda_repeat_norm(p_repeat jsonb, p_dow int)
returns jsonb language plpgsql immutable as $$
declare
  v_freq text := p_repeat ->> 'freq';
  v_days int[];
begin
  if p_repeat is null or v_freq is null or v_freq not in ('daily', 'weekly', 'monthly', 'yearly') then
    return null;
  end if;
  if v_freq = 'weekly' then
    select coalesce(array_agg(distinct d order by d), array[p_dow]) into v_days
      from jsonb_array_elements_text(coalesce(p_repeat -> 'weekdays', '[]'::jsonb)) x(d0), lateral (select x.d0::int as d) y
     where y.d between 0 and 6;
  end if;
  return jsonb_build_object(
    'freq', v_freq,
    'every', greatest(1, least(99, coalesce(nullif(p_repeat ->> 'every', '')::int, 1))),
    'weekdays', to_jsonb(coalesce(v_days, '{}'::int[])),
    'until', nullif(p_repeat ->> 'until', ''),
    'count', case when nullif(p_repeat ->> 'count', '') is null then null
                  else greatest(2, least(500, (p_repeat ->> 'count')::int)) end);
end;
$$;

create or replace function public.agenda_series_rule(s public.agenda_series)
returns jsonb language sql immutable as $$
  select jsonb_build_object('freq', s.freq, 'every', s.every,
    'weekdays', to_jsonb(case when s.freq = 'weekly' then s.weekdays else '{}'::int[] end),
    'until', s.until::text, 'count', s.count)
$$;

-- cria as próximas ocorrências da série, copiando o compromisso modelo, até p_horizon (horário local)
create or replace function public.agenda_series_generate(p_series uuid, p_template uuid, p_horizon timestamp)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.agenda_series%rowtype;
  t public.agenda_events%rowtype;
  v_time time;
  v_people uuid[];
  v_existing int;
  v_made int := 0;
  v_last timestamp;
  v_day date;
  v_cand timestamp;
  v_new uuid;
  k int := 0;
begin
  select * into s from public.agenda_series where id = p_series;
  select * into t from public.agenda_events where id = p_template;
  if s.id is null or t.id is null then
    return 0;
  end if;
  v_time := (t.starts_at at time zone s.tz)::time;
  select coalesce(array_agg(user_id), '{}') into v_people from public.agenda_event_people where event_id = t.id;
  select count(*) into v_existing from public.agenda_events where series_id = s.id;
  v_last := s.generated_until;
  -- as ocorrências criadas aqui não avisam "novo compromisso" (só a primeira avisa)
  perform set_config('app.agenda_series_gen', 'on', true);
  loop
    exit when k > 5000 or v_made >= 500;
    v_day := case s.freq
      when 'daily' then s.anchor::date + k * s.every
      when 'weekly' then s.anchor::date - extract(dow from s.anchor)::int + k
      when 'monthly' then (s.anchor::date + make_interval(months => k * s.every))::date
      else (s.anchor::date + make_interval(years => k * s.every))::date
    end;
    k := k + 1;
    v_cand := v_day + v_time;
    exit when s.until is not null and v_day > s.until;
    exit when v_cand > p_horizon;
    exit when s.count is not null and v_existing >= s.count;
    -- semana: só os dias escolhidos, a cada N semanas, a partir da primeira
    continue when s.freq = 'weekly'
      and (v_day < s.anchor::date or not (extract(dow from v_day)::int = any(s.weekdays)) or ((k - 1) / 7) % s.every <> 0);
    continue when v_cand <= v_last;
    insert into public.agenda_events (company_id, owner_id, created_by, member_id, title, notes, starts_at, all_day, reminders, type_id, series_id)
    values (t.company_id, t.owner_id, t.created_by, t.member_id, t.title, t.notes, v_cand at time zone s.tz, t.all_day, t.reminders, t.type_id, s.id)
    returning id into v_new;
    insert into public.agenda_event_people (event_id, user_id, company_id)
    select v_new, u, t.company_id from unnest(v_people) u on conflict do nothing;
    v_existing := v_existing + 1;
    v_made := v_made + 1;
    v_last := v_cand;
  end loop;
  perform set_config('app.agenda_series_gen', 'off', true);
  update public.agenda_series set generated_until = greatest(generated_until, v_last) where id = s.id;
  return v_made;
end;
$$;
revoke all on function public.agenda_series_generate(uuid, uuid, timestamp) from public, anon, authenticated;

-- nova série a partir de um compromisso (ele é a primeira ocorrência)
create or replace function public.agenda_series_start(p_event uuid, p_rule jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
  v_tz text;
  v_anchor timestamp;
  v_id uuid;
  v_until date := nullif(p_rule ->> 'until', '')::date;
  v_count int := nullif(p_rule ->> 'count', '')::int;
begin
  select * into e from public.agenda_events where id = p_event;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = e.company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_anchor := e.starts_at at time zone v_tz;
  insert into public.agenda_series (company_id, freq, every, weekdays, until, count, tz, anchor, generated_until, created_by)
  values (e.company_id, p_rule ->> 'freq', (p_rule ->> 'every')::int,
          array(select jsonb_array_elements_text(p_rule -> 'weekdays')::int),
          v_until, v_count, v_tz, v_anchor, v_anchor, auth.uid())
  returning id into v_id;
  update public.agenda_events set series_id = v_id where id = p_event;
  -- com fim: tudo (até 5 anos); sem fim: os próximos 12 meses (o resto vem com o tempo)
  perform public.agenda_series_generate(v_id, p_event,
    case when v_until is null and v_count is null then (now() at time zone v_tz) + interval '12 months'
         else v_anchor + interval '5 years' end);
  return v_id;
end;
$$;
revoke all on function public.agenda_series_start(uuid, jsonb) from public, anon, authenticated;

-- encerra a série antes de um compromisso (as ocorrências dele em diante saem dela)
create or replace function public.agenda_series_stop(p_series uuid, p_before timestamptz)
returns void language sql security definer set search_path = public as $$
  update public.agenda_series s
     set until = least(coalesce(s.until, 'infinity'::date), ((p_before at time zone s.tz)::date - 1)),
         count = null
   where s.id = p_series
$$;
revoke all on function public.agenda_series_stop(uuid, timestamptz) from public, anon, authenticated;

-- séries sem fim: mantém 12 meses à frente (o worker chama junto com os lembretes)
create or replace function public.agenda_extend_series()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_total int := 0;
begin
  for r in
    select s.id, s.tz,
           (select e.id from public.agenda_events e where e.series_id = s.id order by e.starts_at desc limit 1) as template
      from public.agenda_series s
     where s.until is null and s.count is null
       and s.generated_until < (now() at time zone s.tz) + interval '11 months'
     limit 50
  loop
    if r.template is not null then
      v_total := v_total + public.agenda_series_generate(r.id, r.template, (now() at time zone r.tz) + interval '12 months');
    end if;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.agenda_extend_series() from public, anon, authenticated;
grant execute on function public.agenda_extend_series() to service_role;

-- "novo compromisso na sua agenda": não avisa cada ocorrência criada pela repetição
create or replace function public.agenda_people_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
  v_tz text;
begin
  if new.user_id = auth.uid() or current_setting('app.agenda_series_gen', true) = 'on' then
    return new;
  end if;
  select * into e from public.agenda_events where id = new.event_id;
  if e.id is null or e.done_at is not null or e.starts_at < now() - interval '1 day' then
    return new;
  end if;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = e.company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  perform public.queue_push(
    e.company_id, 'agenda', 'users',
    '📅 Novo compromisso na sua agenda' || case when e.series_id is not null then ' (repete)' else '' end,
    e.title || ' · ' || to_char(e.starts_at at time zone v_tz, case when e.all_day then 'DD/MM' else 'DD/MM "às" HH24:MI' end),
    '/agenda?evento=' || e.id, null, array[new.user_id], 'agenda:' || e.id);
  return new;
end;
$$;

-- o script 0101 tirou o gatilho deste aviso sem recriar: volta aqui
drop trigger if exists agenda_people_push on public.agenda_event_people;
create trigger agenda_people_push after insert on public.agenda_event_people
  for each row execute function public.agenda_people_push();

-- ------------------------------------------------ gravar / excluir
drop function if exists public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[]);
-- criar / editar (p_id null = novo). p_type: tipo do compromisso. p_repeat: a repetição (null = não
-- mexe; {"freq":"none"} = não repete). p_scope ao editar uma ocorrência: 'one' (só este) ou
-- 'following' (este e os próximos)
create or replace function public.save_agenda_event(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
  p_reminders int[] default null, p_type uuid default null, p_repeat jsonb default null, p_scope text default 'one'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_title text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 2000), '');
  v_people uuid[];
  v_id uuid := p_id;
  v_reminders int[] := (select array_agg(distinct m order by m) from unnest(p_reminders) m where m between 0 and 40320);
  v_type uuid := (select id from public.agenda_event_types where id = p_type and company_id = public.current_company_id());
  v_tz text := coalesce((select nullif(timezone, '') from public.app_settings where company_id = public.current_company_id()), 'America/Sao_Paulo');
  v_rule jsonb := public.agenda_repeat_norm(p_repeat, extract(dow from p_starts_at at time zone
                    coalesce((select nullif(timezone, '') from public.app_settings where company_id = public.current_company_id()), 'America/Sao_Paulo'))::int);
  e public.agenda_events%rowtype;
  s public.agenda_series%rowtype;
  v_delta interval;
  v_ids uuid[];
begin
  if cardinality(v_reminders) > 5 then
    raise exception 'Use no máximo 5 lembretes por compromisso.';
  end if;
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  if v_title is null then
    raise exception 'Informe o título do compromisso.';
  end if;
  if p_starts_at is null then
    raise exception 'Informe a data do compromisso.';
  end if;
  if v_rule is not null and v_rule ->> 'until' is not null and (v_rule ->> 'until')::date < (p_starts_at at time zone v_tz)::date then
    raise exception 'A data final da repetição é antes do compromisso.';
  end if;
  select coalesce(array_agg(distinct p.id), '{}') into v_people
    from public.profiles p where p.id = any(coalesce(p_people, '{}')) and p.company_id = v_company and p.active;
  if cardinality(v_people) = 0 then
    v_people := array[auth.uid()];
  end if;

  if v_id is null then
    insert into public.agenda_events (company_id, owner_id, created_by, title, notes, starts_at, all_day, reminders, type_id)
    values (v_company, auth.uid(), auth.uid(), left(v_title, 200), v_notes, p_starts_at, coalesce(p_all_day, false),
            case when p_reminders is null then case when coalesce(p_all_day, false) then '{0}'::int[] else '{15}'::int[] end
                 else coalesce(v_reminders, '{}') end,
            v_type)
    returning id into v_id;
    insert into public.agenda_event_people (event_id, user_id, company_id)
    select v_id, u, v_company from unnest(v_people) u on conflict do nothing;
    if v_rule is not null then
      perform public.agenda_series_start(v_id, v_rule);
    end if;
    return v_id;
  end if;

  if not public.can_edit_agenda_event(v_id) then
    raise exception 'Compromisso não encontrado.';
  end if;
  select * into e from public.agenda_events where id = v_id;
  select * into s from public.agenda_series where id = e.series_id;

  if s.id is not null and p_scope = 'following' then
    if p_repeat is not null and v_rule is distinct from public.agenda_series_rule(s) then
      -- repetição mudou: a série antiga termina antes deste, que começa outra (ou deixa de repetir)
      delete from public.agenda_events where series_id = s.id and starts_at > e.starts_at;
      perform public.agenda_series_stop(s.id, e.starts_at);
      update public.agenda_events
         set title = left(v_title, 200), notes = v_notes, starts_at = p_starts_at, all_day = coalesce(p_all_day, false),
             reminders = coalesce(v_reminders, case when p_reminders is null then reminders else '{}' end),
             type_id = v_type, series_id = null
       where id = v_id;
      delete from public.agenda_event_people where event_id = v_id and user_id <> all(v_people);
      insert into public.agenda_event_people (event_id, user_id, company_id)
      select v_id, u, v_company from unnest(v_people) u on conflict do nothing;
      if v_rule is not null then
        perform public.agenda_series_start(v_id, v_rule);
      end if;
      return v_id;
    end if;
    -- mesma repetição: muda este e os próximos (o horário anda junto, pela mesma diferença)
    v_delta := p_starts_at - e.starts_at;
    v_ids := array(select id from public.agenda_events where series_id = s.id and starts_at >= e.starts_at);
    update public.agenda_events
       set title = left(v_title, 200), notes = v_notes, starts_at = starts_at + v_delta, all_day = coalesce(p_all_day, false),
           reminders = case when p_reminders is null then reminders else coalesce(v_reminders, '{}') end,
           type_id = v_type
     where id = any(v_ids);
    delete from public.agenda_event_people where event_id = any(v_ids) and user_id <> all(v_people);
    insert into public.agenda_event_people (event_id, user_id, company_id)
    select ev, u, v_company from unnest(v_ids) ev cross join unnest(v_people) u
    on conflict do nothing;
    if v_delta <> interval '0' then
      update public.agenda_series set generated_until = generated_until + v_delta where id = s.id;
    end if;
    return v_id;
  end if;

  -- só este compromisso
  update public.agenda_events
     set title = left(v_title, 200), notes = v_notes, starts_at = p_starts_at, all_day = coalesce(p_all_day, false),
         reminders = case when p_reminders is null then reminders else coalesce(v_reminders, '{}') end,
         type_id = v_type
   where id = v_id;
  delete from public.agenda_event_people where event_id = v_id and user_id <> all(v_people);
  insert into public.agenda_event_people (event_id, user_id, company_id)
  select v_id, u, v_company from unnest(v_people) u on conflict do nothing;
  -- compromisso avulso que passou a repetir
  if s.id is null and v_rule is not null then
    perform public.agenda_series_start(v_id, v_rule);
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text) from public, anon;
grant execute on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text) to authenticated;

-- excluir: 'one' (só este) ou 'following' (este e os próximos da repetição)
create or replace function public.delete_agenda_event(p_id uuid, p_scope text default 'one')
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
begin
  if not public.can_edit_agenda_event(p_id) then
    raise exception 'Compromisso não encontrado.';
  end if;
  select * into e from public.agenda_events where id = p_id;
  if p_scope = 'following' and e.series_id is not null then
    perform public.agenda_series_stop(e.series_id, e.starts_at);
    delete from public.agenda_events where series_id = e.series_id and starts_at >= e.starts_at;
  else
    delete from public.agenda_events where id = p_id;
  end if;
end;
$$;
revoke all on function public.delete_agenda_event(uuid, text) from public, anon;
grant execute on function public.delete_agenda_event(uuid, text) to authenticated;
