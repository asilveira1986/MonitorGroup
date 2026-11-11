-- =====================================================================
-- Agenda: compromisso de vários dias (começa num dia e termina em outro).
--
--  * O término pode cair em outro dia (até 31 dias depois do início), também
--    em "dia todo" (de um dia ao outro). Antes só valia até 24 h e não valia
--    em "dia todo".
--  * Em repetição, cada ocorrência guarda a mesma duração (a regra de
--    herdar a duração, 0172, passa a valer também para "dia todo").
-- =====================================================================

-- a duração herdada vale também para "dia todo" com término em outro dia
create or replace function public.agenda_events_end_default()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(current_setting('app.agenda_duration_min', true), '');
begin
  if new.ends_at is null then
    if v is null then
      select new.starts_at + (e.ends_at - e.starts_at) into new.ends_at
        from public.agenda_events e
       where e.series_id is not null and e.series_id = new.series_id and e.ends_at is not null
       order by e.starts_at desc limit 1;
    elsif v <> 'none' then
      new.ends_at := new.starts_at + make_interval(mins => v::int);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.save_agenda_event(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
  p_reminders int[] default null, p_type uuid default null, p_repeat jsonb default null, p_scope text default 'one',
  p_nature text default null, p_ends_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_series uuid;
  v_start timestamptz;
  v_min int;
begin
  if p_nature is not null and p_nature not in ('professional', 'personal') then
    raise exception 'Escolha se o compromisso é particular ou profissional.';
  end if;
  if p_id is null and p_nature is null then
    raise exception 'Escolha se o compromisso é particular ou profissional.';
  end if;
  -- término em outro dia (0175): compromisso de vários dias, até 31 dias; "dia todo" vale só de um dia ao outro
  if p_ends_at is not null then
    if p_ends_at <= p_starts_at then
      raise exception 'O término deve ser depois do início.';
    end if;
    if p_ends_at > p_starts_at + interval '31 days' then
      raise exception 'O compromisso pode durar até 31 dias. Para períodos maiores, use a repetição.';
    end if;
  end if;
  v_min := case when p_ends_at is null then null else (extract(epoch from (p_ends_at - p_starts_at)) / 60)::int end;
  -- as ocorrências criadas dentro desta chamada nascem com a natureza e a duração escolhidas
  perform set_config('app.agenda_nature', coalesce(p_nature, ''), true);
  perform set_config('app.agenda_duration_min', coalesce(v_min::text, 'none'), true);
  v_id := public.save_agenda_event_core(p_id, p_title, p_notes, p_starts_at, p_all_day, p_people, p_reminders, p_type, p_repeat, p_scope);
  select series_id, starts_at into v_series, v_start from public.agenda_events where id = v_id;
  if p_nature is not null then
    if p_id is not null and v_series is not null and p_scope = 'following' then
      update public.agenda_events set nature = p_nature where series_id = v_series and starts_at >= v_start;
    else
      update public.agenda_events set nature = p_nature where id = v_id;
    end if;
  end if;
  -- término: este compromisso (ou este e os próximos) com a duração escolhida; sem término, limpa
  if p_id is not null and v_series is not null and p_scope = 'following' then
    update public.agenda_events
       set ends_at = case when v_min is null then null else starts_at + make_interval(mins => v_min) end
     where series_id = v_series and starts_at >= v_start;
  else
    update public.agenda_events
       set ends_at = case when v_min is null then null else starts_at + make_interval(mins => v_min) end
     where id = v_id;
  end if;
  perform set_config('app.agenda_nature', '', true);
  perform set_config('app.agenda_duration_min', '', true);
  return v_id;
end;
$$;
revoke all on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text, text, timestamptz) to authenticated;
