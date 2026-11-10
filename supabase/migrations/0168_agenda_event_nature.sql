-- =====================================================================
-- Agenda: todo compromisso é "particular" ou "profissional" (obrigatório).
--
--  * agenda_events.nature: 'professional' | 'personal'. Os compromissos que
--    já existiam ficam como profissionais.
--  * save_agenda_event passa a receber p_nature: obrigatório ao criar (sem
--    ele: "Escolha se o compromisso é particular ou profissional."); na
--    edição, vazio mantém o que estava. Numa repetição, vale para este e os
--    próximos quando o escopo é "este e os próximos".
--  * As ocorrências geradas de uma repetição herdam a natureza do
--    compromisso (trigger), sem mexer nas funções da repetição.
-- A função antiga virou save_agenda_event_core (mesma lógica, só que sem a
-- natureza); a nova chama a antiga e grava a natureza em seguida.
-- =====================================================================

alter table public.agenda_events add column if not exists nature text;
update public.agenda_events set nature = 'professional' where nature is null;
alter table public.agenda_events drop constraint if exists agenda_events_nature_check;
alter table public.agenda_events add constraint agenda_events_nature_check check (nature in ('professional', 'personal'));

-- natureza de quem nasce sem ela: a escolhida no salvamento (variável da transação), a da série, ou profissional
create or replace function public.agenda_events_nature_default()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(current_setting('app.agenda_nature', true), '');
begin
  if new.nature is null then
    new.nature := coalesce(
      v,
      (select e.nature from public.agenda_events e where e.series_id is not null and e.series_id = new.series_id and e.nature is not null
        order by e.starts_at desc limit 1),
      'professional');
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_events_nature_default on public.agenda_events;
create trigger agenda_events_nature_default before insert on public.agenda_events
  for each row execute function public.agenda_events_nature_default();

-- a função antiga vira o "miolo"
do $$
begin
  if to_regprocedure('public.save_agenda_event(uuid,text,text,timestamptz,boolean,uuid[],integer[],uuid,jsonb,text)') is not null
     and to_regprocedure('public.save_agenda_event_core(uuid,text,text,timestamptz,boolean,uuid[],integer[],uuid,jsonb,text)') is null then
    alter function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text) rename to save_agenda_event_core;
  end if;
end $$;

create or replace function public.save_agenda_event(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
  p_reminders int[] default null, p_type uuid default null, p_repeat jsonb default null, p_scope text default 'one',
  p_nature text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_series uuid;
  v_start timestamptz;
begin
  if p_nature is not null and p_nature not in ('professional', 'personal') then
    raise exception 'Escolha se o compromisso é particular ou profissional.';
  end if;
  if p_id is null and p_nature is null then
    raise exception 'Escolha se o compromisso é particular ou profissional.';
  end if;
  -- as ocorrências criadas dentro desta chamada nascem com a natureza escolhida
  perform set_config('app.agenda_nature', coalesce(p_nature, ''), true);
  v_id := public.save_agenda_event_core(p_id, p_title, p_notes, p_starts_at, p_all_day, p_people, p_reminders, p_type, p_repeat, p_scope);
  if p_nature is not null then
    select series_id, starts_at into v_series, v_start from public.agenda_events where id = v_id;
    if p_id is not null and v_series is not null and p_scope = 'following' then
      update public.agenda_events set nature = p_nature where series_id = v_series and starts_at >= v_start;
    else
      update public.agenda_events set nature = p_nature where id = v_id;
    end if;
  end if;
  perform set_config('app.agenda_nature', '', true);
  return v_id;
end;
$$;
revoke all on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text, text) from public, anon;
grant execute on function public.save_agenda_event(uuid, text, text, timestamptz, boolean, uuid[], int[], uuid, jsonb, text, text) to authenticated;
