-- =====================================================================
-- Agenda: vários lembretes por compromisso e a notificação abrindo o
-- compromisso.
--
--  * agenda_events.reminders: minutos antes do horário em que cada
--    lembrete toca (0 = na hora). Até 5 por compromisso. Dia todo: conta
--    a partir das 8h do dia (0 = no dia às 8h, 1440 = na véspera às 8h).
--    Os compromissos já registrados ficam com 15 min antes, como era.
--  * save_agenda_event ganha p_reminders (sem informar: 15 min antes; no
--    dia todo, no dia às 8h; ao editar, mantém os que já tinha).
--  * As notificações da agenda abrem o compromisso (/agenda?evento=...).
-- =====================================================================

alter table public.agenda_events add column if not exists reminders int[] not null default '{15}';
alter table public.agenda_events drop constraint if exists agenda_events_reminders_check;
alter table public.agenda_events add constraint agenda_events_reminders_check
  check (cardinality(reminders) <= 5 and 0 <= all(reminders) and 40320 >= all(reminders));

-- "em 15 min", "em 2 h", "amanhã"...
create or replace function public.agenda_reminder_label(p_minutes int, p_all_day boolean default false)
returns text language sql immutable as $$
  select case
    when p_all_day then case when p_minutes < 1440 then 'hoje' when p_minutes < 2880 then 'amanhã'
                             else 'em ' || (p_minutes / 1440) || ' dias' end
    when p_minutes = 0 then 'agora'
    when p_minutes < 60 then 'em ' || p_minutes || ' min'
    when p_minutes < 1440 then 'em ' || (p_minutes / 60) || ' h' || case when p_minutes % 60 > 0 then ' ' || (p_minutes % 60) || ' min' else '' end
    when p_minutes = 1440 then 'amanhã'
    else 'em ' || (p_minutes / 1440) || ' dias'
  end
$$;

drop function if exists public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[]);
-- criar / editar um compromisso com os participantes (p_id null = novo)
create or replace function public.save_agenda_event(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
  p_reminders int[] default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_title text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  v_people uuid[];
  v_id uuid := p_id;
  -- lembretes: minutos antes (0 = na hora), sem repetir, até 5, no máximo 4 semanas antes
  v_reminders int[] := (select array_agg(distinct m order by m) from unnest(p_reminders) m where m between 0 and 40320);
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
  -- só usuários ativos desta empresa; sem ninguém, fica na agenda de quem criou
  select coalesce(array_agg(distinct p.id), '{}') into v_people
    from public.profiles p where p.id = any(coalesce(p_people, '{}')) and p.company_id = v_company and p.active;
  if cardinality(v_people) = 0 then
    v_people := array[auth.uid()];
  end if;

  if v_id is null then
    insert into public.agenda_events (company_id, owner_id, created_by, title, notes, starts_at, all_day, reminders)
    values (v_company, auth.uid(), auth.uid(), left(v_title, 200), nullif(left(btrim(coalesce(p_notes, '')), 2000), ''), p_starts_at, coalesce(p_all_day, false),
            -- sem informar: 15 min antes (dia todo: no dia, às 8h); lista vazia = sem lembrete
            case when p_reminders is null then case when coalesce(p_all_day, false) then '{0}'::int[] else '{15}'::int[] end
                 else coalesce(v_reminders, '{}') end)
    returning id into v_id;
  else
    if not public.can_edit_agenda_event(v_id) then
      raise exception 'Compromisso não encontrado.';
    end if;
    update public.agenda_events
       set title = left(v_title, 200), notes = nullif(left(btrim(coalesce(p_notes, '')), 2000), ''),
           starts_at = p_starts_at, all_day = coalesce(p_all_day, false),
           reminders = case when p_reminders is null then reminders else coalesce(v_reminders, '{}') end
     where id = v_id;
    delete from public.agenda_event_people where event_id = v_id and user_id <> all(v_people);
  end if;
  insert into public.agenda_event_people (event_id, user_id, company_id)
  select v_id, u, v_company from unnest(v_people) u
  on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[]) from public, anon;
grant execute on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[]) to authenticated;

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
    '/agenda?evento=' || e.id, null, array[new.user_id], 'agenda:' || e.id);
  return new;
end;
$$;
drop trigger if exists agenda_people_push on public.agenda_event_people;

-- ------------------------------------------------ lembretes (o worker chama a cada minuto)
create or replace function public.queue_scheduled_pushes()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
begin
  -- lembretes dos compromissos: cada um na hora escolhida (minutos antes do horário; dia todo:
  -- antes das 8h do dia). Atraso de até 15 min (worker reiniciando) ainda avisa; mais que isso, não.
  for r in
    select x.*,
           x.base - make_interval(mins => x.m) as fire_at
      from (
        select e.*, m, coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo') as tz,
               case when e.all_day
                    then (((e.starts_at at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))::date + time '08:00')
                          at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))
                    else e.starts_at end as base
          from public.agenda_events e
          cross join lateral unnest(e.reminders) m
          left join public.app_settings s on s.company_id = e.company_id
         where e.done_at is null
           and e.starts_at > now() - interval '1 day' and e.starts_at < now() + interval '29 days'
      ) x
     where x.base - make_interval(mins => x.m) <= now()
       and x.base - make_interval(mins => x.m) > now() - interval '15 minutes'
  loop
    perform public.queue_push(
      r.company_id, 'agenda', 'users', '⏰ ' || r.title,
      case when r.all_day then 'Dia todo · ' || to_char(r.starts_at at time zone r.tz, 'DD/MM')
           else to_char(r.starts_at at time zone r.tz, 'DD/MM "às" HH24:MI') end
        || ' · ' || public.agenda_reminder_label(r.m, r.all_day),
      '/agenda?evento=' || r.id, null,
      array(select x.user_id from public.agenda_event_people x where x.event_id = r.id
            union select unnest(public.team_member_user_ids(r.member_id)) where r.member_id is not null),
      'agenda:' || r.id || ':' || r.m, 'agenda-rem:' || r.id || ':' || r.starts_at || ':' || r.m || ':' || r.all_day);
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
