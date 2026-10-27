-- =====================================================================
-- Avisos no WhatsApp da equipe (compromissos e demandas).
--
--  * Novo compromisso: quem foi incluído num compromisso (por outra
--    pessoa) recebe o aviso no WhatsApp dele.
--  * Lembretes: nos lembretes escolhidos no compromisso (15 min antes,
--    na véspera...), o aviso vai também pelo WhatsApp.
--  * Nova demanda: o responsável recebe o aviso no WhatsApp ao ganhar uma
--    demanda.
--  * Cada aviso liga/desliga e tem o texto com variáveis em Configurações
--    › Avisos no WhatsApp (administradores). Começam desligados.
--  * O número de cada pessoa: o telefone do perfil (Meu perfil) ou, sem
--    ele, o da pessoa da equipe ligada ao e-mail. Sai pelo WhatsApp
--    conectado da empresa; aviso parado por mais de 30 min não sai.
-- =====================================================================

alter table public.app_settings
  add column if not exists agenda_whats_new boolean not null default false,
  add column if not exists agenda_whats_new_template text,
  add column if not exists agenda_whats_reminder boolean not null default false,
  add column if not exists agenda_whats_reminder_template text,
  add column if not exists demand_whats_assignee boolean not null default false,
  add column if not exists demand_whats_assignee_template text;

create table if not exists public.team_whatsapp_queue (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  phone      text not null,
  body       text not null,
  -- endereço da tela no painel (o worker troca {link} pelo endereço completo)
  link_path  text,
  dedupe_key text unique,
  status     text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists team_whatsapp_queue_pending_idx on public.team_whatsapp_queue (created_at) where status = 'pending';
alter table public.team_whatsapp_queue enable row level security;
revoke all on public.team_whatsapp_queue from anon, authenticated;
grant select, insert, update, delete on public.team_whatsapp_queue to service_role;

-- WhatsApp do usuário: o do perfil ou o da pessoa da equipe ligada (só dígitos, com 55 no Brasil)
create or replace function public.user_whatsapp_phone(p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  select regexp_replace(coalesce(nullif(p.phone, ''),
           (select t.phone from public.team_members t
             where t.company_id = p.company_id and lower(t.user_email) = lower(p.email) and t.phone is not null limit 1), ''), '\D', '', 'g')
    into v
    from public.profiles p where p.id = p_user and p.active;
  if v is null or v = '' then
    return null;
  end if;
  if length(v) between 10 and 11 then
    v := '55' || v;
  end if;
  return case when length(v) between 12 and 15 then v end;
end;
$$;
revoke all on function public.user_whatsapp_phone(uuid) from public, anon, authenticated;

create or replace function public.queue_team_whatsapp(p_company uuid, p_user uuid, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.user_whatsapp_phone(p_user);
begin
  if v_phone is null or nullif(btrim(coalesce(p_body, '')), '') is null then
    return;
  end if;
  insert into public.team_whatsapp_queue (company_id, user_id, phone, body, link_path, dedupe_key)
  values (p_company, p_user, v_phone, left(p_body, 4000), p_link, p_dedupe)
  on conflict (dedupe_key) do nothing;
exception when others then
  -- o aviso nunca impede a gravação que o originou
  raise warning 'aviso no WhatsApp da equipe não entrou na fila: %', sqlerrm;
end;
$$;
revoke all on function public.queue_team_whatsapp(uuid, uuid, text, text, text) from public, anon, authenticated;

-- texto do aviso de um compromisso, com as variáveis trocadas
create or replace function public.agenda_notice_text(p_template text, p_event uuid, p_minutes int default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
  v_tz text;
  v_type text;
  v_by text;
  v_people text;
begin
  select * into e from public.agenda_events where id = p_event;
  if e.id is null then
    return null;
  end if;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = e.company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  select name into v_type from public.agenda_event_types where id = e.type_id;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_by from public.profiles where id = coalesce(e.owner_id, e.created_by);
  select string_agg(coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)), ', ' order by p.full_name)
    into v_people
    from public.agenda_event_people x join public.profiles p on p.id = x.user_id where x.event_id = e.id;
  return replace(replace(replace(replace(replace(replace(replace(replace(p_template,
    '{titulo}', e.title),
    '{data}', to_char(e.starts_at at time zone v_tz, 'DD/MM/YYYY')),
    '{hora}', case when e.all_day then 'dia todo' else 'às ' || to_char(e.starts_at at time zone v_tz, 'HH24:MI') end),
    '{quando}', case when p_minutes is null then '' else public.agenda_reminder_label(p_minutes, e.all_day) end),
    '{tipo}', coalesce(v_type, 'Compromisso')),
    '{observacao}', case when nullif(btrim(coalesce(e.notes, '')), '') is null then '' else E'\n\n📝 *Observação:* ' || btrim(e.notes) end),
    '{participantes}', coalesce(v_people, '')),
    '{criado_por}', coalesce(v_by, ''));
end;
$$;
revoke all on function public.agenda_notice_text(text, uuid, int) from public, anon, authenticated;

-- ------------------------------------------------ novo compromisso
create or replace function public.agenda_people_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  e public.agenda_events%rowtype;
begin
  if new.user_id = auth.uid() or current_setting('app.agenda_series_gen', true) = 'on' then
    return new;
  end if;
  select * into e from public.agenda_events where id = new.event_id;
  if e.id is null or e.done_at is not null or e.starts_at < now() then
    return new;
  end if;
  select * into s from public.app_settings where company_id = e.company_id;
  if not coalesce(s.agenda_whats_new, false) then
    return new;
  end if;
  perform public.queue_team_whatsapp(
    e.company_id, new.user_id,
    public.agenda_notice_text(coalesce(nullif(btrim(s.agenda_whats_new_template), ''),
      E'📅 *Novo compromisso na sua agenda*\n*{titulo}*\n🗓️ {data} {hora}{observacao}\n\nMarcado por {criado_por}'), e.id),
    '/agenda?evento=' || e.id, 'agenda-new:' || e.id || ':' || new.user_id);
  return new;
end;
$$;
drop trigger if exists agenda_people_whatsapp on public.agenda_event_people;
create trigger agenda_people_whatsapp after insert on public.agenda_event_people
  for each row execute function public.agenda_people_whatsapp();

-- ------------------------------------------------ lembretes (o worker chama a cada minuto)
create or replace function public.queue_team_whatsapp_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  u uuid;
  v_count int := 0;
begin
  for r in
    select x.*
      from (
        select e.id, e.company_id, e.starts_at, e.all_day, e.member_id, m,
               coalesce(nullif(s.agenda_whats_reminder_template, ''), E'⏰ *Lembrete:* {titulo}\n🗓️ {data} {hora} ({quando}){observacao}') as tpl,
               case when e.all_day
                    then (((e.starts_at at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))::date + time '08:00')
                          at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))
                    else e.starts_at end as base
          from public.agenda_events e
          cross join lateral unnest(e.reminders) m
          join public.app_settings s on s.company_id = e.company_id and s.agenda_whats_reminder
         where e.done_at is null
           and e.starts_at > now() - interval '1 day' and e.starts_at < now() + interval '29 days'
      ) x
     where x.base - make_interval(mins => x.m) <= now()
       and x.base - make_interval(mins => x.m) > now() - interval '15 minutes'
  loop
    for u in
      select y.user_id from public.agenda_event_people y where y.event_id = r.id
      union select unnest(public.team_member_user_ids(r.member_id)) where r.member_id is not null
    loop
      perform public.queue_team_whatsapp(
        r.company_id, u, public.agenda_notice_text(r.tpl, r.id, r.m), '/agenda?evento=' || r.id,
        'agenda-rem:' || r.id || ':' || r.starts_at || ':' || r.m || ':' || r.all_day || ':' || u);
      v_count := v_count + 1;
    end loop;
  end loop;
  -- limpeza: avisos com mais de 7 dias
  delete from public.team_whatsapp_queue where created_at < now() - interval '7 days';
  return v_count;
end;
$$;
revoke all on function public.queue_team_whatsapp_reminders() from public, anon, authenticated;
grant execute on function public.queue_team_whatsapp_reminders() to service_role;

-- ------------------------------------------------ nova demanda para o responsável
create or replace function public.demands_whatsapp_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings%rowtype;
  v_tz text;
  v_group text;
  v_text text;
  u uuid;
begin
  if new.assignee_id is null or new.status not in ('aberta', 'em_andamento')
     or (tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id) then
    return new;
  end if;
  select * into s from public.app_settings where company_id = new.company_id;
  if not coalesce(s.demand_whats_assignee, false) then
    return new;
  end if;
  v_tz := coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo');
  select name into v_group from public.groups where id = new.group_id;
  v_text := replace(replace(replace(replace(replace(
    coalesce(nullif(btrim(s.demand_whats_assignee_template), ''),
             E'📋 *Nova demanda para você* (nº {numero})\n{demanda}\n\n👥 *Grupo:* {grupo}\n📅 *Prazo:* {prazo}'),
    '{numero}', coalesce(new.number::text, '')),
    '{demanda}', coalesce(new.description, '')),
    '{tipo}', coalesce(new.type, '')),
    '{grupo}', coalesce(v_group, '')),
    '{prazo}', case when new.promised_at is null then 'a definir'
                    else to_char(new.promised_at at time zone v_tz, 'DD/MM/YYYY "às" HH24:MI') end);
  for u in select x from unnest(public.team_member_user_ids(new.assignee_id)) x where x is distinct from auth.uid() loop
    perform public.queue_team_whatsapp(new.company_id, u, v_text, '/demands', 'demand-assignee:' || new.id || ':' || new.assignee_id || ':' || u);
  end loop;
  return new;
end;
$$;
drop trigger if exists demands_whatsapp_assignee on public.demands;
create trigger demands_whatsapp_assignee after insert or update of assignee_id on public.demands
  for each row execute function public.demands_whatsapp_assignee();

-- ------------------------------------------------ envio (worker)
create or replace function public.claim_team_whatsapp(p_limit int default 20)
returns setof public.team_whatsapp_queue language plpgsql security definer set search_path = public as $$
begin
  update public.team_whatsapp_queue set status = 'expired'
   where status = 'pending' and created_at < now() - interval '30 minutes';
  return query
  update public.team_whatsapp_queue q set status = 'sending'
   where q.id in (select id from public.team_whatsapp_queue where status = 'pending' order by created_at
                  limit greatest(1, least(p_limit, 100)) for update skip locked)
  returning q.*;
end;
$$;
revoke all on function public.claim_team_whatsapp(int) from public, anon, authenticated;
grant execute on function public.claim_team_whatsapp(int) to service_role;
