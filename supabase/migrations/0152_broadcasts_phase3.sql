-- =====================================================================
-- Disparos, fase 3: recorrência, relatório (entregue / lido / respondeu) e filtro "sem conversa há X dias".
--
--  * Recorrência: um disparo recorrente é uma campanha "série" (status 'series', sem destinatários) com
--    recurrence = {freq: daily|weekly|monthly, time, days, day_of_month, until}. No horário, o worker
--    chama broadcast_spawn_due(): ela cria uma campanha filha (series_id) com o público recalculado
--    na hora, e agenda a próxima. Se a filha anterior ainda não terminou, ou o público está vazio, pula.
--  * Relatório: broadcast_recipients ganha delivered_at, read_at e replied_at. O worker grava os recibos
--    do WhatsApp (broadcast_track) e a resposta da pessoa (broadcast_register_reply, até 7 dias depois).
--    broadcast_report(id) soma tudo (de uma série, soma as filhas).
--  * Filtro inactive_days: grupos sem mensagem, ou pessoas sem conversa privada, há pelo menos N dias.
--  * broadcast_audience_for(empresa, filtro): o público sem depender do usuário logado (a série usa no
--    worker). broadcast_audience continua exigindo o administrador geral e chama a anterior.
-- =====================================================================

alter table public.broadcast_recipients add column if not exists delivered_at timestamptz;
alter table public.broadcast_recipients add column if not exists read_at timestamptz;
alter table public.broadcast_recipients add column if not exists replied_at timestamptz;
create index if not exists broadcast_recipients_wa_idx on public.broadcast_recipients (wa_message_id) where wa_message_id is not null;

alter table public.broadcast_campaigns add column if not exists recurrence jsonb;
alter table public.broadcast_campaigns add column if not exists next_run_at timestamptz;
alter table public.broadcast_campaigns add column if not exists series_id uuid references public.broadcast_campaigns(id) on delete set null;
alter table public.broadcast_campaigns add column if not exists last_run_at timestamptz;
alter table public.broadcast_campaigns add column if not exists last_run_note text;
create index if not exists broadcast_campaigns_series_idx on public.broadcast_campaigns (series_id) where series_id is not null;
create index if not exists broadcast_campaigns_due_idx on public.broadcast_campaigns (next_run_at) where status = 'series';

do $$
begin
  alter table public.broadcast_campaigns drop constraint if exists broadcast_campaigns_status_check;
  alter table public.broadcast_campaigns add constraint broadcast_campaigns_status_check
    check (status in ('scheduled', 'running', 'paused', 'done', 'cancelled', 'series'));
end $$;

-- ------------------------------------------------ recibos e respostas (worker)
-- status do WhatsApp: 3 entregue, 4 lida, 5 reproduzida. Só avança.
create or replace function public.broadcast_track(p_wa_message_id text, p_status int)
returns void language sql security definer set search_path = public as $$
  update public.broadcast_recipients
     set delivered_at = coalesce(delivered_at, now()),
         read_at = case when p_status >= 4 then coalesce(read_at, now()) else read_at end
   where wa_message_id = p_wa_message_id and status = 'sent' and p_status >= 3
     and (delivered_at is null or (p_status >= 4 and read_at is null))
$$;
revoke all on function public.broadcast_track(text, int) from public, anon, authenticated;
grant execute on function public.broadcast_track(text, int) to service_role;

-- A pessoa respondeu a um disparo (últimos 7 dias): conta como resposta. Devolve quantos marcou.
create or replace function public.broadcast_register_reply(p_instance_id uuid, p_jid text, p_alt text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_phone text;
  v_n int;
begin
  select company_id into v_company from public.whatsapp_instances where id = p_instance_id;
  if v_company is null then
    return 0;
  end if;
  v_phone := public.br_phone(split_part(coalesce(nullif(p_alt, ''), p_jid), '@', 1));
  if p_jid like '%@lid' and nullif(p_alt, '') is null then
    select public.br_phone(w.phone) into v_phone from public.wa_contacts w
     where w.instance_id = p_instance_id and w.jid = p_jid and w.phone is not null limit 1;
  end if;
  if v_phone is null then
    return 0;
  end if;
  update public.broadcast_recipients
     set replied_at = now()
   where company_id = v_company and kind = 'person' and status = 'sent' and replied_at is null
     and sent_at > now() - interval '7 days'
     and public.phone_key(phone) = public.phone_key(v_phone);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.broadcast_register_reply(uuid, text, text) from public, anon, authenticated;
grant execute on function public.broadcast_register_reply(uuid, text, text) to service_role;

-- ------------------------------------------------ público por empresa (com "sem conversa há X dias")
-- Filtro: o da 0151 + inactive_days (grupos: sem mensagem há N dias; pessoas: sem conversa privada há N dias).
create or replace function public.broadcast_audience_for(p_company uuid, p_filter jsonb)
returns table (kind text, group_id uuid, name text, phone text, jid text, instance_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := p_company;
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_all boolean := coalesce((p_filter->>'all')::boolean, false);
  v_mode text := case when p_filter->>'tag_mode' = 'all' then 'all' else 'any' end;
  v_tags uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'tag_ids')::uuid), '{}');
  v_exclude uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'exclude_tag_ids')::uuid), '{}');
  v_sector uuid := nullif(p_filter->>'sector_id', '')::uuid;
  v_groups uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'group_ids')::uuid), '{}');
  v_phones text[] := coalesce(array(select public.br_phone(x) from jsonb_array_elements_text(p_filter->'phones') x), '{}');
  v_extra jsonb := case when jsonb_typeof(p_filter->'extra') = 'array' then p_filter->'extra' else '[]'::jsonb end;
  v_inactive int := case when coalesce(p_filter->>'inactive_days', '') ~ '^[0-9]+$' then (p_filter->>'inactive_days')::int else null end;
  v_cut timestamptz := case when v_inactive is not null and v_inactive > 0 then now() - make_interval(days => v_inactive) end;
begin
  if v_target = 'groups' then
    return query
      select 'group'::text, g.id, g.name, null::text, g.jid, g.instance_id
        from public.groups g
       where g.company_id = v_company and g.removed_at is null
         and (v_all or g.id = any(v_groups)
              -- etiquetas, setor e inatividade juntos: precisa cumprir todos os que foram usados
              or ((cardinality(v_tags) > 0 or v_sector is not null or v_cut is not null)
                  and (cardinality(v_tags) = 0 or case when v_mode = 'all' then g.tags @> v_tags else g.tags && v_tags end)
                  and (v_sector is null or g.sector_id = v_sector)))
         -- inatividade restringe o que foi escolhido pelos filtros; o que foi marcado à mão entra sempre
         and (v_cut is null or g.id = any(v_groups) or coalesce(g.last_message_at, g.created_at) < v_cut)
         and not (g.tags && v_exclude)
       order by g.name;
    return;
  end if;

  return query
    with extra as (
      select public.br_phone(e->>'phone') as ph, nullif(btrim(coalesce(e->>'name', '')), '') as nm
        from jsonb_array_elements(v_extra) e
    ), src as (
      select public.br_phone(k.phone) as ph, k.name as nm, k.tags as tg, 1 as pr
        from public.contacts k where k.company_id = v_company and public.br_phone(k.phone) is not null
      union all
      select public.br_phone(c.phone), c.name, c.tags, 2
        from public.private_chats c
       where c.company_id = v_company and public.br_phone(c.phone) is not null and c.jid not like '%@g.us'
      union all
      select public.br_phone(w.phone), coalesce(w.name, w.notify), '{}'::uuid[], 3
        from public.wa_contacts w
       where w.company_id = v_company and public.br_phone(w.phone) is not null
         and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
      union all
      select x.ph, x.nm, '{}'::uuid[], 4 from extra x where x.ph is not null and length(x.ph) >= 12
    ), keyed as (
      select public.phone_key(s.ph) as k, s.ph, s.nm, s.tg, s.pr from src s
    ), merged as (
      select max(kd.ph) as ph,
             (array_agg(kd.nm order by kd.pr) filter (where kd.nm is not null))[1] as nm,
             coalesce(array_agg(distinct t) filter (where t is not null), '{}'::uuid[]) as tags,
             bool_or(kd.pr = 4) as imported,
             kd.k
        from keyed kd
        left join lateral unnest(kd.tg) as t on true
       group by kd.k
    )
    select 'person'::text, null::uuid, m.nm, m.ph, null::text, null::uuid
      from merged m
     where (v_all or m.imported or m.ph = any(v_phones)
            or (cardinality(v_tags) > 0
                and case when v_mode = 'all' then m.tags @> v_tags else m.tags && v_tags end)
            or (v_cut is not null and cardinality(v_tags) = 0))
       -- inatividade (junto com etiquetas, precisa cumprir os dois): sem conversa privada recente
       and (v_cut is null or m.imported or m.ph = any(v_phones)
            or not exists (select 1 from public.private_chats c
                            where c.company_id = v_company and public.phone_key(c.phone) = m.k
                              and c.last_message_at is not null and c.last_message_at >= v_cut))
       and not (m.tags && v_exclude)
       and not exists (select 1 from public.broadcast_optouts o
                        where o.company_id = v_company and public.phone_key(o.phone) = m.k)
     order by m.nm nulls last, m.ph;
end;
$$;
revoke all on function public.broadcast_audience_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.broadcast_audience_for(uuid, jsonb) to service_role;

create or replace function public.broadcast_audience(p_filter jsonb)
returns table (kind text, group_id uuid, name text, phone text, jid text, instance_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  return query select * from public.broadcast_audience_for(public.current_company_id(), p_filter);
end;
$$;

-- ------------------------------------------------ recorrência
-- recurrence = {"freq":"daily"|"weekly"|"monthly", "time":"09:00", "days":[1,3], "day_of_month":5, "until":"2026-12-31"}
-- Próximo horário depois de p_after, no fuso da empresa; null se passou do "until".
create or replace function public.broadcast_next_run(p_rec jsonb, p_after timestamptz, p_tz text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_freq text := p_rec->>'freq';
  v_time time := coalesce(nullif(p_rec->>'time', ''), '09:00')::time;
  v_days int[] := coalesce(array(select jsonb_array_elements_text(p_rec->'days')::int), '{}');
  v_dom int := coalesce(nullif(p_rec->>'day_of_month', '')::int, 1);
  v_until date := nullif(p_rec->>'until', '')::date;
  v_d date;
  v_cand timestamptz;
  v_last int;
  i int;
begin
  v_d := (p_after at time zone p_tz)::date;
  for i in 0..400 loop
    if v_until is not null and v_d > v_until then
      return null;
    end if;
    v_cand := (v_d + v_time) at time zone p_tz;
    if v_cand > p_after then
      if v_freq = 'daily' then
        return v_cand;
      elsif v_freq = 'weekly' and extract(dow from v_d)::int = any(v_days) then
        return v_cand;
      elsif v_freq = 'monthly' then
        -- dia 31 em mês curto vale o último dia do mês
        v_last := extract(day from (date_trunc('month', v_d) + interval '1 month' - interval '1 day'))::int;
        if extract(day from v_d)::int = least(v_dom, v_last) then
          return v_cand;
        end if;
      end if;
    end if;
    v_d := v_d + 1;
  end loop;
  return null;
end;
$$;

create or replace function public.broadcast_recurrence_check(p_rec jsonb)
returns void language plpgsql immutable set search_path = public as $$
declare
  v_freq text := p_rec->>'freq';
  v_days int[];
begin
  if jsonb_typeof(p_rec) <> 'object' or v_freq not in ('daily', 'weekly', 'monthly') then
    raise exception 'Escolha como o disparo se repete: todo dia, toda semana ou todo mês.';
  end if;
  if coalesce(p_rec->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Horário de envio inválido.';
  end if;
  if v_freq = 'weekly' then
    v_days := coalesce(array(select jsonb_array_elements_text(p_rec->'days')::int), '{}');
    if cardinality(v_days) = 0 or exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      raise exception 'Escolha os dias da semana em que o disparo se repete.';
    end if;
  end if;
  if v_freq = 'monthly' and (coalesce(p_rec->>'day_of_month', '') !~ '^[0-9]+$' or (p_rec->>'day_of_month')::int not between 1 and 31) then
    raise exception 'Escolha o dia do mês (1 a 31).';
  end if;
  if nullif(p_rec->>'until', '') is not null and (p_rec->>'until') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data final inválida.';
  end if;
end;
$$;

-- ------------------------------------------------ criar (agora também recorrente)
drop function if exists public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[], text[], jsonb, jsonb, boolean);
-- p_recurrence: {freq, time, days, day_of_month, until}; com ele o disparo vira uma série (o público é calculado a
-- cada envio) e p_scheduled_at é a data a partir da qual vale.
create or replace function public.broadcast_create(
  p_name text, p_filter jsonb, p_message text, p_instance_id uuid default null,
  p_scheduled_at timestamptz default null, p_skip text[] default '{}',
  p_variants text[] default '{}', p_media jsonb default null, p_window jsonb default null,
  p_optout_footer boolean default true, p_recurrence jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_msg text := coalesce(btrim(coalesce(p_message, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_variants text[] := coalesce(array(select btrim(x) from unnest(coalesce(p_variants, '{}')) x where btrim(x) <> ''), '{}');
  v_media_path text := nullif(p_media->>'path', '');
  v_media_type text := nullif(p_media->>'type', '');
  v_series boolean := p_recurrence is not null and jsonb_typeof(p_recurrence) = 'object';
  v_tz text;
  v_next timestamptz;
  v_days int[];
  v_start text;
  v_end text;
  v_id uuid;
  v_n int;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  if v_target not in ('groups', 'people') then
    raise exception 'Escolha para quem enviar: grupos ou pessoas.';
  end if;
  if v_name is null then
    raise exception 'Dê um nome ao disparo.';
  end if;
  if v_msg = '' and v_media_path is null then
    raise exception 'Escreva a mensagem ou anexe um arquivo.';
  end if;
  if length(v_msg) > 4000 or exists (select 1 from unnest(v_variants) x where length(x) > 4000) then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if cardinality(v_variants) > 4 then
    raise exception 'No máximo 4 variações além do texto principal.';
  end if;
  if cardinality(v_variants) > 0 and v_msg = '' then
    raise exception 'Escreva o texto principal para usar variações.';
  end if;
  if v_media_path is not null then
    if v_media_path not like v_company::text || '/%' then
      raise exception 'Arquivo inválido.';
    end if;
    if v_media_type is null or v_media_type not in ('image', 'video', 'document', 'audio') then
      raise exception 'Tipo de arquivo inválido.';
    end if;
  end if;
  if v_target = 'people' then
    if p_instance_id is null or not exists (select 1 from public.whatsapp_instances i where i.id = p_instance_id and i.company_id = v_company) then
      raise exception 'Escolha o número do WhatsApp que envia.';
    end if;
  end if;
  if p_window is not null and jsonb_typeof(p_window) = 'object' then
    v_days := coalesce(array(select jsonb_array_elements_text(p_window->'days')::int), '{}');
    v_start := coalesce(p_window->>'start', '08:00');
    v_end := coalesce(p_window->>'end', '18:00');
    if cardinality(v_days) = 0 or exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      raise exception 'Escolha os dias da semana do horário de envio.';
    end if;
    if v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_start = v_end then
      raise exception 'Horário de envio inválido.';
    end if;
  end if;

  if v_series then
    perform public.broadcast_recurrence_check(p_recurrence);
    select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = v_company;
    v_next := public.broadcast_next_run(p_recurrence, coalesce(p_scheduled_at, now()), coalesce(v_tz, 'America/Sao_Paulo'));
    if v_next is null then
      raise exception 'A data final já passou: o disparo nunca seria enviado.';
    end if;
    -- confere que o filtro acha alguém hoje (o público é recalculado a cada envio)
    select count(*) into v_n from public.broadcast_audience_for(v_company, p_filter);
    if v_n = 0 then
      raise exception 'O público está vazio: nenhum destinatário para enviar.';
    end if;
  end if;

  insert into public.broadcast_campaigns (company_id, name, target, audience, instance_id, message, status, scheduled_at, created_by,
                                          variants, media_path, media_mime, media_name, media_type,
                                          window_enabled, window_days, window_start, window_end, optout_footer,
                                          recurrence, next_run_at)
  values (v_company, v_name, v_target, p_filter, case when v_target = 'people' then p_instance_id end, v_msg,
          case when v_series then 'series' else 'scheduled' end, coalesce(p_scheduled_at, now()), auth.uid(),
          v_variants, v_media_path, nullif(p_media->>'mime', ''), nullif(p_media->>'name', ''), v_media_type,
          v_days is not null, coalesce(v_days, '{1,2,3,4,5}'), coalesce(v_start, '08:00'), coalesce(v_end, '18:00'),
          coalesce(p_optout_footer, true) and v_target = 'people',
          case when v_series then p_recurrence end, v_next)
  returning id into v_id;

  if not v_series then
    insert into public.broadcast_recipients (campaign_id, company_id, kind, group_id, name, phone, jid, instance_id)
    select v_id, v_company, a.kind, a.group_id, a.name, a.phone, a.jid,
           case when v_target = 'people' then p_instance_id else a.instance_id end
      from public.broadcast_audience(p_filter) a
     where coalesce(a.group_id::text, a.phone) <> all (coalesce(p_skip, '{}'));
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'O público está vazio: nenhum destinatário para enviar.';
    end if;
    if v_n > 5000 then
      raise exception 'No máximo 5000 destinatários por disparo (são %).', v_n;
    end if;
  end if;

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary, details)
  select v_company, p.id, p.email, p.full_name, 'atendimento', 'criou', 'broadcast_campaigns', v_id::text,
         case when v_series then 'Criou o disparo recorrente "' || v_name || '"'
              else 'Criou o disparo "' || v_name || '" para ' || v_n || case when v_target = 'groups' then ' grupo(s)' else ' pessoa(s)' end end,
         jsonb_build_object('agendado_para', coalesce(p_scheduled_at, now()), 'com_arquivo', v_media_path is not null,
                            'variacoes', cardinality(v_variants), 'janela', v_days is not null, 'recorrente', v_series)
    from public.profiles p where p.id = auth.uid();
  return v_id;
end;
$$;
revoke all on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[], text[], jsonb, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[], text[], jsonb, jsonb, boolean, jsonb) to authenticated;

-- ------------------------------------------------ pausar, retomar, cancelar (agora também a série)
create or replace function public.broadcast_set_status(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c public.broadcast_campaigns;
  v_summary text;
  v_tz text;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  select * into v_c from public.broadcast_campaigns where id = p_id and company_id = public.current_company_id() for update;
  if not found then
    raise exception 'Disparo não encontrado.';
  end if;
  if v_c.status in ('done', 'cancelled') then
    raise exception 'Este disparo já terminou.';
  end if;

  if p_action = 'pause' then
    update public.broadcast_campaigns set status = 'paused' where id = p_id;
    v_summary := 'Pausou';
  elsif p_action = 'resume' then
    if v_c.status <> 'paused' then
      raise exception 'Só dá para retomar um disparo pausado.';
    end if;
    if v_c.recurrence is not null then
      -- série: volta a repetir; se a hora já passou, vale a próxima
      select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = v_c.company_id;
      update public.broadcast_campaigns
         set status = 'series',
             next_run_at = case when next_run_at is null or next_run_at <= now()
                                then public.broadcast_next_run(recurrence, now(), coalesce(v_tz, 'America/Sao_Paulo')) else next_run_at end
       where id = p_id;
    else
      update public.broadcast_campaigns
         set status = case when started_at is null then 'scheduled' else 'running' end,
             scheduled_at = case when started_at is null then greatest(scheduled_at, now()) else scheduled_at end
       where id = p_id;
    end if;
    v_summary := 'Retomou';
  elsif p_action = 'cancel' then
    update public.broadcast_campaigns set status = 'cancelled', finished_at = now() where id = p_id;
    update public.broadcast_recipients set status = 'skipped', error = 'Disparo cancelado' where campaign_id = p_id and status = 'pending';
    -- cancelar a série cancela também o que ela já criou e ainda não terminou
    if v_c.recurrence is not null then
      update public.broadcast_recipients r set status = 'skipped', error = 'Disparo cancelado'
       where r.status = 'pending' and r.campaign_id in (select id from public.broadcast_campaigns where series_id = p_id and status in ('scheduled', 'running', 'paused'));
      update public.broadcast_campaigns set status = 'cancelled', finished_at = now()
       where series_id = p_id and status in ('scheduled', 'running', 'paused');
    end if;
    v_summary := 'Cancelou';
  else
    raise exception 'Ação inválida.';
  end if;

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_c.company_id, p.id, p.email, p.full_name, 'atendimento', 'alterou', 'broadcast_campaigns', p_id::text,
         v_summary || ' o disparo "' || v_c.name || '"'
    from public.profiles p where p.id = auth.uid();
end;
$$;

-- ------------------------------------------------ o worker cria os envios da série na hora
create or replace function public.broadcast_spawn_due()
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.broadcast_campaigns;
  v_tz text;
  v_child uuid;
  v_n int;
  v_next timestamptz;
  v_spawned int := 0;
  v_note text;
begin
  for s in
    select * from public.broadcast_campaigns
     where status = 'series' and next_run_at is not null and next_run_at <= now()
     order by next_run_at
       for update skip locked
  loop
    select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = s.company_id;
    v_tz := coalesce(v_tz, 'America/Sao_Paulo');
    v_next := public.broadcast_next_run(s.recurrence, now(), v_tz);
    v_note := null;

    if exists (select 1 from public.broadcast_campaigns c where c.series_id = s.id and c.status in ('scheduled', 'running', 'paused')) then
      v_note := 'Pulado: o envio anterior ainda não terminou.';
    else
      insert into public.broadcast_campaigns (company_id, name, target, audience, instance_id, message, status, scheduled_at, created_by,
                                              variants, media_path, media_mime, media_name, media_type,
                                              window_enabled, window_days, window_start, window_end, optout_footer, series_id)
      values (s.company_id, s.name || ' · ' || to_char(now() at time zone v_tz, 'DD/MM/YYYY HH24:MI'), s.target, s.audience, s.instance_id,
              s.message, 'scheduled', now(), s.created_by,
              s.variants, s.media_path, s.media_mime, s.media_name, s.media_type,
              s.window_enabled, s.window_days, s.window_start, s.window_end, s.optout_footer, s.id)
      returning id into v_child;

      insert into public.broadcast_recipients (campaign_id, company_id, kind, group_id, name, phone, jid, instance_id)
      select v_child, s.company_id, a.kind, a.group_id, a.name, a.phone, a.jid,
             case when s.target = 'people' then s.instance_id else a.instance_id end
        from public.broadcast_audience_for(s.company_id, s.audience) a;
      get diagnostics v_n = row_count;

      if v_n = 0 then
        delete from public.broadcast_campaigns where id = v_child;
        v_note := 'Pulado: nenhum destinatário no filtro neste horário.';
      elsif v_n > 5000 then
        delete from public.broadcast_campaigns where id = v_child;
        v_note := 'Pulado: o público passou de 5000 destinatários (' || v_n || ').';
      else
        v_spawned := v_spawned + 1;
        v_note := 'Enviado para ' || v_n || ' destinatário(s).';
      end if;
    end if;

    update public.broadcast_campaigns
       set last_run_at = now(), last_run_note = v_note, next_run_at = v_next,
           status = case when v_next is null then 'done' else 'series' end,
           finished_at = case when v_next is null then now() else finished_at end
     where id = s.id;
  end loop;
  return v_spawned;
end;
$$;
revoke all on function public.broadcast_spawn_due() from public, anon, authenticated;
grant execute on function public.broadcast_spawn_due() to service_role;

-- ------------------------------------------------ relatório
-- Soma os destinatários do disparo (de uma série, os de todas as filhas). Entregue/lido/respondeu só valem
-- para pessoas (no grupo o WhatsApp não dá recibo por pessoa para o número de quem enviou).
create or replace function public.broadcast_report(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'total', count(*),
      'sent', count(*) filter (where r.status = 'sent'),
      'failed', count(*) filter (where r.status = 'failed'),
      'skipped', count(*) filter (where r.status = 'skipped'),
      'pending', count(*) filter (where r.status in ('pending', 'sending')),
      'delivered', count(*) filter (where r.status = 'sent' and (r.delivered_at is not null or r.read_at is not null)),
      'read', count(*) filter (where r.status = 'sent' and r.read_at is not null),
      'replied', count(*) filter (where r.status = 'sent' and r.replied_at is not null),
      'people', count(*) filter (where r.kind = 'person' and r.status = 'sent'))
      from public.broadcast_recipients r
      join public.broadcast_campaigns c on c.id = r.campaign_id
     where c.company_id = public.current_company_id() and (c.id = p_id or c.series_id = p_id)
  );
end;
$$;
revoke all on function public.broadcast_report(uuid) from public, anon;
grant execute on function public.broadcast_report(uuid) to authenticated;

notify pgrst, 'reload schema';
