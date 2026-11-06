-- =====================================================================
-- Disparos, fase 2: mídia, variações do texto, públicos salvos, números importados (CSV),
-- janela de horário, reenvio das falhas e opt-out.
--
--  * broadcast_campaigns: variants (textos alternativos sorteados por destinatário), media_* (imagem,
--    vídeo, documento ou áudio guardado no Storage), window_* (só enviar em certos dias e horas) e
--    optout_footer (rodapé "responda SAIR" nas mensagens a pessoas). A mensagem pode ficar vazia
--    quando há arquivo (a legenda é opcional).
--  * broadcast_optouts: quem pediu para não receber. Fica de fora dos públicos e, por garantia, o worker
--    confere de novo antes de cada envio. O pedido chega por resposta ("SAIR") a um disparo recente
--    ou é cadastrado à mão.
--  * broadcast_audiences: públicos salvos (nome + filtro) para reutilizar.
--  * broadcast_audience: passa a aceitar números extras (filter.extra = [{phone, name}], vindos do CSV),
--    tira quem fez opt-out e dá prioridade ao nome do cadastro do sistema.
--  * broadcast_create: novos parâmetros. broadcast_retry_failed: devolve as falhas para a fila.
-- =====================================================================

alter table public.broadcast_campaigns add column if not exists variants text[] not null default '{}';
alter table public.broadcast_campaigns add column if not exists media_path text;
alter table public.broadcast_campaigns add column if not exists media_mime text;
alter table public.broadcast_campaigns add column if not exists media_name text;
alter table public.broadcast_campaigns add column if not exists media_type text;
alter table public.broadcast_campaigns add column if not exists window_enabled boolean not null default false;
alter table public.broadcast_campaigns add column if not exists window_days int[] not null default '{1,2,3,4,5}';
alter table public.broadcast_campaigns add column if not exists window_start text not null default '08:00';
alter table public.broadcast_campaigns add column if not exists window_end text not null default '18:00';
alter table public.broadcast_campaigns add column if not exists optout_footer boolean not null default true;

do $$
begin
  begin
    alter table public.broadcast_campaigns add constraint broadcast_campaigns_media_type_check
      check (media_type is null or media_type in ('image', 'video', 'document', 'audio'));
  exception when duplicate_object then null;
  end;
  -- a mensagem pode ficar vazia quando há arquivo (a função de criação confere)
  alter table public.broadcast_campaigns drop constraint if exists broadcast_campaigns_message_check;
  alter table public.broadcast_campaigns add constraint broadcast_campaigns_message_check check (length(message) <= 4000);
end $$;

-- ------------------------------------------------ opt-out
create table if not exists public.broadcast_optouts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  phone      text not null,
  name       text,
  source     text not null default 'manual' check (source in ('reply', 'manual')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists broadcast_optouts_phone_idx on public.broadcast_optouts (company_id, public.phone_key(phone));
alter table public.broadcast_optouts enable row level security;
drop policy if exists broadcast_optouts_read on public.broadcast_optouts;
create policy broadcast_optouts_read on public.broadcast_optouts for select
  using ((select public.can_use_broadcasts()) and company_id = (select public.current_company_id()));
revoke all on public.broadcast_optouts from anon;
grant select on public.broadcast_optouts to authenticated;
grant select, insert, update, delete on public.broadcast_optouts to service_role;

create or replace function public.broadcast_optout_add(p_phone text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_phone text := public.br_phone(p_phone);
  v_id uuid;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  if v_phone is null or length(v_phone) < 12 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  insert into public.broadcast_optouts (company_id, phone, name, source, created_by)
  values (v_company, v_phone, nullif(btrim(coalesce(p_name, '')), ''), 'manual', auth.uid())
  on conflict (company_id, public.phone_key(phone)) do update set name = coalesce(excluded.name, public.broadcast_optouts.name)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.broadcast_optout_add(text, text) from public, anon;
grant execute on function public.broadcast_optout_add(text, text) to authenticated;

create or replace function public.broadcast_optout_remove(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  delete from public.broadcast_optouts where id = p_id and company_id = public.current_company_id();
end;
$$;
revoke all on function public.broadcast_optout_remove(uuid) from public, anon;
grant execute on function public.broadcast_optout_remove(uuid) to authenticated;

-- O worker chama quando alguém responde "SAIR" no privado. Só vale para quem recebeu um disparo nos
-- últimos 14 dias (uma conversa comum com a palavra "sair" não cadastra ninguém). Devolve true se cadastrou.
create or replace function public.broadcast_register_optout(p_instance_id uuid, p_jid text, p_alt text default null, p_name text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_phone text;
begin
  select company_id into v_company from public.whatsapp_instances where id = p_instance_id;
  if v_company is null then
    return false;
  end if;
  v_phone := public.br_phone(split_part(coalesce(nullif(p_alt, ''), p_jid), '@', 1));
  if p_jid like '%@lid' and nullif(p_alt, '') is null then
    select public.br_phone(w.phone) into v_phone from public.wa_contacts w
     where w.instance_id = p_instance_id and w.jid = p_jid and w.phone is not null limit 1;
  end if;
  if v_phone is null then
    return false;
  end if;
  if not exists (
    select 1 from public.broadcast_recipients r
     where r.company_id = v_company and r.kind = 'person' and r.status = 'sent'
       and r.sent_at > now() - interval '14 days'
       and public.phone_key(r.phone) = public.phone_key(v_phone)
  ) then
    return false;
  end if;
  insert into public.broadcast_optouts (company_id, phone, name, source)
  values (v_company, v_phone, nullif(btrim(coalesce(p_name, '')), ''), 'reply')
  on conflict (company_id, public.phone_key(phone)) do nothing;
  return true;
end;
$$;
revoke all on function public.broadcast_register_optout(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.broadcast_register_optout(uuid, text, text, text) to service_role;

-- ------------------------------------------------ públicos salvos
create table if not exists public.broadcast_audiences (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  target     text not null check (target in ('groups', 'people')),
  filter     jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists broadcast_audiences_name_idx on public.broadcast_audiences (company_id, lower(name));
alter table public.broadcast_audiences enable row level security;
drop policy if exists broadcast_audiences_read on public.broadcast_audiences;
create policy broadcast_audiences_read on public.broadcast_audiences for select
  using ((select public.can_use_broadcasts()) and company_id = (select public.current_company_id()));
revoke all on public.broadcast_audiences from anon;
grant select on public.broadcast_audiences to authenticated;
grant select, insert, update, delete on public.broadcast_audiences to service_role;

create or replace function public.broadcast_audience_save(p_name text, p_filter jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_id uuid;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Dê um nome ao público.';
  end if;
  if v_target not in ('groups', 'people') then
    raise exception 'Escolha para quem enviar: grupos ou pessoas.';
  end if;
  insert into public.broadcast_audiences (company_id, name, target, filter, created_by)
  values (public.current_company_id(), v_name, v_target, p_filter, auth.uid())
  on conflict (company_id, lower(name)) do update set target = excluded.target, filter = excluded.filter
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.broadcast_audience_save(text, jsonb) from public, anon;
grant execute on function public.broadcast_audience_save(text, jsonb) to authenticated;

create or replace function public.broadcast_audience_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  delete from public.broadcast_audiences where id = p_id and company_id = public.current_company_id();
end;
$$;
revoke all on function public.broadcast_audience_delete(uuid) from public, anon;
grant execute on function public.broadcast_audience_delete(uuid) to authenticated;

-- ------------------------------------------------ público (agora com números extras e opt-out)
-- Filtro: o da 0150 + extra = [{phone, name}] (pessoas; entram sempre, vêm do CSV).
create or replace function public.broadcast_audience(p_filter jsonb)
returns table (kind text, group_id uuid, name text, phone text, jid text, instance_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_all boolean := coalesce((p_filter->>'all')::boolean, false);
  v_mode text := case when p_filter->>'tag_mode' = 'all' then 'all' else 'any' end;
  v_tags uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'tag_ids')::uuid), '{}');
  v_exclude uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'exclude_tag_ids')::uuid), '{}');
  v_sector uuid := nullif(p_filter->>'sector_id', '')::uuid;
  v_groups uuid[] := coalesce(array(select jsonb_array_elements_text(p_filter->'group_ids')::uuid), '{}');
  v_phones text[] := coalesce(array(select public.br_phone(x) from jsonb_array_elements_text(p_filter->'phones') x), '{}');
  v_extra jsonb := case when jsonb_typeof(p_filter->'extra') = 'array' then p_filter->'extra' else '[]'::jsonb end;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;

  if v_target = 'groups' then
    return query
      select 'group'::text, g.id, g.name, null::text, g.jid, g.instance_id
        from public.groups g
       where g.company_id = v_company and g.removed_at is null
         and (v_all or g.id = any(v_groups)
              -- etiquetas e setor juntos: precisa cumprir os dois
              or ((cardinality(v_tags) > 0 or v_sector is not null)
                  and (cardinality(v_tags) = 0 or case when v_mode = 'all' then g.tags @> v_tags else g.tags && v_tags end)
                  and (v_sector is null or g.sector_id = v_sector)))
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
      -- uma linha por pessoa (mesmo número, com ou sem o 9), com as etiquetas de todos os cadastros
      select max(kd.ph) as ph,
             (array_agg(kd.nm order by kd.pr) filter (where kd.nm is not null))[1] as nm,
             coalesce(array_agg(distinct t) filter (where t is not null), '{}'::uuid[]) as tags,
             bool_or(kd.pr = 4) as imported
        from keyed kd
        left join lateral unnest(kd.tg) as t on true
       group by kd.k
    )
    select 'person'::text, null::uuid, m.nm, m.ph, null::text, null::uuid
      from merged m
     where (v_all or m.imported or m.ph = any(v_phones)
            or (cardinality(v_tags) > 0
                and case when v_mode = 'all' then m.tags @> v_tags else m.tags && v_tags end))
       and not (m.tags && v_exclude)
       and not exists (select 1 from public.broadcast_optouts o
                        where o.company_id = v_company and public.phone_key(o.phone) = public.phone_key(m.ph))
     order by m.nm nulls last, m.ph;
end;
$$;

-- ------------------------------------------------ criar (novos parâmetros)
drop function if exists public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[]);
-- p_variants: textos alternativos; p_media: {path, mime, name, type}; p_window: {days, start, end} (null = sem janela)
create or replace function public.broadcast_create(
  p_name text, p_filter jsonb, p_message text, p_instance_id uuid default null,
  p_scheduled_at timestamptz default null, p_skip text[] default '{}',
  p_variants text[] default '{}', p_media jsonb default null, p_window jsonb default null,
  p_optout_footer boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_msg text := coalesce(btrim(coalesce(p_message, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_variants text[] := coalesce(array(select btrim(x) from unnest(coalesce(p_variants, '{}')) x where btrim(x) <> ''), '{}');
  v_media_path text := nullif(p_media->>'path', '');
  v_media_type text := nullif(p_media->>'type', '');
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

  insert into public.broadcast_campaigns (company_id, name, target, audience, instance_id, message, status, scheduled_at, created_by,
                                          variants, media_path, media_mime, media_name, media_type,
                                          window_enabled, window_days, window_start, window_end, optout_footer)
  values (v_company, v_name, v_target, p_filter, case when v_target = 'people' then p_instance_id end, v_msg,
          'scheduled', coalesce(p_scheduled_at, now()), auth.uid(),
          v_variants, v_media_path, nullif(p_media->>'mime', ''), nullif(p_media->>'name', ''), v_media_type,
          v_days is not null, coalesce(v_days, '{1,2,3,4,5}'), coalesce(v_start, '08:00'), coalesce(v_end, '18:00'),
          coalesce(p_optout_footer, true) and v_target = 'people')
  returning id into v_id;

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

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary, details)
  select v_company, p.id, p.email, p.full_name, 'atendimento', 'criou', 'broadcast_campaigns', v_id::text,
         'Criou o disparo "' || v_name || '" para ' || v_n || case when v_target = 'groups' then ' grupo(s)' else ' pessoa(s)' end,
         jsonb_build_object('agendado_para', coalesce(p_scheduled_at, now()), 'com_arquivo', v_media_path is not null,
                            'variacoes', cardinality(v_variants), 'janela', v_days is not null)
    from public.profiles p where p.id = auth.uid();
  return v_id;
end;
$$;
revoke all on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[], text[], jsonb, jsonb, boolean) from public, anon;
grant execute on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[], text[], jsonb, jsonb, boolean) to authenticated;

-- ------------------------------------------------ reenviar as falhas
-- As que "ficaram enviando" por uma queda do sistema não voltam (podem ter sido enviadas: reenviar duplicaria).
create or replace function public.broadcast_retry_failed(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_c public.broadcast_campaigns;
  v_n int;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  select * into v_c from public.broadcast_campaigns where id = p_id and company_id = public.current_company_id() for update;
  if not found then
    raise exception 'Disparo não encontrado.';
  end if;
  if v_c.status = 'cancelled' then
    raise exception 'Este disparo foi cancelado.';
  end if;
  update public.broadcast_recipients
     set status = 'pending', error = null
   where campaign_id = p_id and status = 'failed' and coalesce(error, '') not like 'Interrompido%';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Não há falhas para reenviar.';
  end if;
  if v_c.status = 'done' then
    update public.broadcast_campaigns set status = 'running', finished_at = null where id = p_id;
  end if;
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_c.company_id, p.id, p.email, p.full_name, 'atendimento', 'alterou', 'broadcast_campaigns', p_id::text,
         'Reenviou ' || v_n || ' falha(s) do disparo "' || v_c.name || '"'
    from public.profiles p where p.id = auth.uid();
  return v_n;
end;
$$;
revoke all on function public.broadcast_retry_failed(uuid) from public, anon;
grant execute on function public.broadcast_retry_failed(uuid) to authenticated;

notify pgrst, 'reload schema';
