-- =====================================================================
-- Agenda: hora de término do compromisso.
--
--  * agenda_events.ends_at (opcional; "dia todo" não tem). Compromisso sem
--    término continua como antes (só o início).
--  * save_agenda_event ganha p_ends_at: vazio = sem término. O término tem
--    que ser depois do início e no máximo 24 h depois. Em repetição, cada
--    ocorrência guarda a mesma duração (as geradas depois também).
--  * Mudar o início de um compromisso (inclusive "este e os próximos") leva
--    o término junto, mantendo a duração.
--  * agenda_busy (0169) passa a devolver o término dos "Ocupado".
-- =====================================================================

alter table public.agenda_events add column if not exists ends_at timestamptz;

-- término de quem nasce sem ele: a duração escolhida no salvamento (variável da transação; 'none' = sem término) ou a da série
create or replace function public.agenda_events_end_default()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(current_setting('app.agenda_duration_min', true), '');
begin
  if new.ends_at is null and not coalesce(new.all_day, false) then
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
drop trigger if exists agenda_events_end_default on public.agenda_events;
create trigger agenda_events_end_default before insert on public.agenda_events
  for each row execute function public.agenda_events_end_default();

-- mudou o início (editar, "este e os próximos"): o término acompanha, com a mesma duração
create or replace function public.agenda_events_end_follow()
returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at and new.ends_at is not null and new.ends_at is not distinct from old.ends_at then
    new.ends_at := new.ends_at + (new.starts_at - old.starts_at);
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_events_end_follow on public.agenda_events;
create trigger agenda_events_end_follow before update of starts_at on public.agenda_events
  for each row execute function public.agenda_events_end_follow();

-- a função de 11 parâmetros (0168) é substituída pela de 12 (mesmos nomes + p_ends_at)
drop function if exists public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text, text);
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
  if coalesce(p_all_day, false) then
    p_ends_at := null;
  elsif p_ends_at is not null then
    if p_ends_at <= p_starts_at then
      raise exception 'O término deve ser depois do início.';
    end if;
    if p_ends_at > p_starts_at + interval '24 hours' then
      raise exception 'O término pode ser até 24 horas depois do início. Para mais tempo, use "dia todo".';
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

-- "Ocupado" (0169) com o término
create or replace function public.agenda_busy(p_from timestamptz, p_to timestamptz, p_users uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'all_day', b.all_day, 'user_ids', b.user_ids)
                            order by b.starts_at), '[]'::jsonb)
    from (
      select e.starts_at, e.ends_at, e.all_day, array_agg(distinct x.user_id) as user_ids
        from public.agenda_events e
        join public.agenda_event_people x on x.event_id = e.id
       where public.is_active_user()
         and e.company_id = public.current_company_id()
         and e.nature = 'personal'
         and e.done_at is null
         and x.user_id = any(coalesce(p_users, '{}'))
         and e.starts_at >= p_from and e.starts_at < p_to
         and not public.can_see_agenda_event(e.id)
       group by e.id, e.starts_at, e.ends_at, e.all_day
       limit 2000
    ) b
$$;
revoke all on function public.agenda_busy(timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.agenda_busy(timestamptz, timestamptz, uuid[]) to authenticated;
