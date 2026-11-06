-- =====================================================================
-- Disparos: mensagens em massa para grupos e pessoas (Automações › Disparos).
--
-- O administrador escolhe o público por filtros (todos os grupos, etiquetas, setor, escolha manual; para
-- pessoas: etiquetas dos contatos e das conversas privadas ou números escolhidos), escreve a mensagem
-- (com {nome}, {primeiro_nome} e {grupo}) e envia agora ou agenda. O worker envia no ritmo configurado
-- (intervalo aleatório entre mensagens, pausa a cada lote e limite em 24 h) para proteger o número.
--
--  * broadcast_campaigns:  a campanha (mensagem, agenda, estado).
--  * broadcast_recipients: um destinatário por linha (grupo ou pessoa), com o resultado do envio.
--  * app_settings.broadcast_*: ritmo de envio da empresa.
--  * broadcast_audience / broadcast_create / broadcast_set_status / broadcast_counts: funções do painel.
--
-- Só administradores da empresa criam e acompanham. O envio é do worker (service_role).
-- =====================================================================

alter table public.app_settings add column if not exists broadcast_min_delay_s int not null default 8;
alter table public.app_settings add column if not exists broadcast_max_delay_s int not null default 25;
alter table public.app_settings add column if not exists broadcast_batch_size int not null default 40;
alter table public.app_settings add column if not exists broadcast_batch_pause_min int not null default 5;
alter table public.app_settings add column if not exists broadcast_daily_limit int not null default 200;

create table if not exists public.broadcast_campaigns (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  target       text not null check (target in ('groups', 'people')),
  -- filtro usado para montar o público (fica de registro)
  audience     jsonb not null default '{}'::jsonb,
  -- número que envia aos grupos é o de cada grupo; para pessoas, este
  instance_id  uuid references public.whatsapp_instances(id) on delete set null,
  message      text not null check (length(btrim(message)) between 1 and 4000),
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'running', 'paused', 'done', 'cancelled')),
  scheduled_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists broadcast_campaigns_company_idx on public.broadcast_campaigns (company_id, created_at desc);
create index if not exists broadcast_campaigns_active_idx on public.broadcast_campaigns (scheduled_at) where status in ('scheduled', 'running');

create table if not exists public.broadcast_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.broadcast_campaigns(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  kind          text not null check (kind in ('group', 'person')),
  group_id      uuid references public.groups(id) on delete set null,
  name          text,
  phone         text,
  jid           text,
  instance_id   uuid references public.whatsapp_instances(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error         text,
  wa_message_id text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists broadcast_recipients_once_idx
  on public.broadcast_recipients (campaign_id, coalesce(group_id::text, phone));
create index if not exists broadcast_recipients_pending_idx on public.broadcast_recipients (campaign_id, created_at) where status = 'pending';
create index if not exists broadcast_recipients_sent_idx on public.broadcast_recipients (instance_id, sent_at) where status = 'sent';

alter table public.broadcast_campaigns  enable row level security;
alter table public.broadcast_recipients enable row level security;
drop policy if exists broadcast_campaigns_read on public.broadcast_campaigns;
create policy broadcast_campaigns_read on public.broadcast_campaigns for select
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));
drop policy if exists broadcast_recipients_read on public.broadcast_recipients;
create policy broadcast_recipients_read on public.broadcast_recipients for select
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));
revoke all on public.broadcast_campaigns, public.broadcast_recipients from anon;
grant select on public.broadcast_campaigns, public.broadcast_recipients to authenticated;
grant select, insert, update, delete on public.broadcast_campaigns, public.broadcast_recipients to service_role;

do $$
begin
  begin alter publication supabase_realtime add table public.broadcast_campaigns; exception when others then null; end;
  begin alter publication supabase_realtime add table public.broadcast_recipients; exception when others then null; end;
end $$;

-- ------------------------------------------------ público
-- Filtro (jsonb):
--   target        'groups' | 'people'
--   all           true = todos (grupos ativos, ou todas as pessoas com telefone)
--   tag_ids       etiquetas; tag_mode 'any' (qualquer uma, padrão) ou 'all' (todas)
--   exclude_tag_ids  quem tem alguma dessas etiquetas fica de fora
--   sector_id     (grupos) só os grupos do setor
--   group_ids     (grupos) escolhidos à mão, somam ao filtro
--   phones        (pessoas) números escolhidos à mão, somam ao filtro
-- Sem nenhum critério o resultado é vazio (nunca "todos" por engano).
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
begin
  if not public.is_admin() then
    raise exception 'Só administradores usam os disparos.' using errcode = '42501';
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
    with src as (
      select public.br_phone(k.phone) as ph, k.name as nm, k.tags as tg
        from public.contacts k where k.company_id = v_company and public.br_phone(k.phone) is not null
      union all
      select public.br_phone(c.phone), c.name, c.tags
        from public.private_chats c
       where c.company_id = v_company and public.br_phone(c.phone) is not null and c.jid not like '%@g.us'
      union all
      select public.br_phone(w.phone), coalesce(w.name, w.notify), '{}'::uuid[]
        from public.wa_contacts w
       where w.company_id = v_company and public.br_phone(w.phone) is not null
         and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    ), keyed as (
      select public.phone_key(s.ph) as k, s.ph, s.nm, s.tg from src s
    ), merged as (
      -- uma linha por pessoa (mesmo número, com ou sem o 9), com as etiquetas de todos os cadastros
      select max(kd.ph) as ph,
             (array_agg(kd.nm) filter (where kd.nm is not null))[1] as nm,
             coalesce(array_agg(distinct t) filter (where t is not null), '{}'::uuid[]) as tags
        from keyed kd
        left join lateral unnest(kd.tg) as t on true
       group by kd.k
    )
    select 'person'::text, null::uuid, m.nm, m.ph, null::text, null::uuid
      from merged m
     where (v_all or m.ph = any(v_phones)
            or (cardinality(v_tags) > 0
                and case when v_mode = 'all' then m.tags @> v_tags else m.tags && v_tags end))
       and not (m.tags && v_exclude)
     order by m.nm nulls last, m.ph;
end;
$$;
revoke all on function public.broadcast_audience(jsonb) from public, anon;
grant execute on function public.broadcast_audience(jsonb) to authenticated;

-- Prévia para a tela: total exato e as primeiras linhas (a API limita as respostas, por isso volta em jsonb).
-- p_search filtra por nome ou telefone (lista de escolha manual).
create or replace function public.broadcast_preview(p_filter jsonb, p_limit int default 500, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_out jsonb;
begin
  select jsonb_build_object(
           'total', count(*),
           'rows', coalesce(jsonb_agg(jsonb_build_object('key', coalesce(x.group_id::text, x.phone), 'name', x.name,
                     'sub', case when x.kind = 'person' then x.phone end) order by x.rn) filter (where x.rn <= greatest(p_limit, 0)), '[]'::jsonb))
    into v_out
    from (select a.*, row_number() over () as rn
            from public.broadcast_audience(p_filter) a
           where v_term is null or a.name ilike '%' || v_term || '%' or (v_digits is not null and a.phone like '%' || v_digits || '%')) x;
  return v_out;
end;
$$;
revoke all on function public.broadcast_preview(jsonb, int, text) from public, anon;
grant execute on function public.broadcast_preview(jsonb, int, text) to authenticated;

-- ------------------------------------------------ criar e enviar/agendar
-- p_skip: chaves dos destinatários que o usuário desmarcou na revisão (id do grupo ou telefone)
create or replace function public.broadcast_create(
  p_name text, p_filter jsonb, p_message text, p_instance_id uuid default null,
  p_scheduled_at timestamptz default null, p_skip text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_target text := coalesce(p_filter->>'target', 'groups');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Só administradores usam os disparos.' using errcode = '42501';
  end if;
  if v_target not in ('groups', 'people') then
    raise exception 'Escolha para quem enviar: grupos ou pessoas.';
  end if;
  if v_name is null then
    raise exception 'Dê um nome ao disparo.';
  end if;
  if v_msg is null then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_msg) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if v_target = 'people' then
    if p_instance_id is null or not exists (select 1 from public.whatsapp_instances i where i.id = p_instance_id and i.company_id = v_company) then
      raise exception 'Escolha o número do WhatsApp que envia.';
    end if;
  end if;

  insert into public.broadcast_campaigns (company_id, name, target, audience, instance_id, message, status, scheduled_at, created_by)
  values (v_company, v_name, v_target, p_filter, case when v_target = 'people' then p_instance_id end, v_msg,
          'scheduled', coalesce(p_scheduled_at, now()), auth.uid())
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
         jsonb_build_object('agendado_para', coalesce(p_scheduled_at, now()))
    from public.profiles p where p.id = auth.uid();
  return v_id;
end;
$$;
revoke all on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[]) from public, anon;
grant execute on function public.broadcast_create(text, jsonb, text, uuid, timestamptz, text[]) to authenticated;

-- ------------------------------------------------ pausar, retomar, cancelar
create or replace function public.broadcast_set_status(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c public.broadcast_campaigns;
  v_summary text;
begin
  if not public.is_admin() then
    raise exception 'Só administradores usam os disparos.' using errcode = '42501';
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
    update public.broadcast_campaigns
       set status = case when started_at is null then 'scheduled' else 'running' end,
           scheduled_at = case when started_at is null then greatest(scheduled_at, now()) else scheduled_at end
     where id = p_id;
    v_summary := 'Retomou';
  elsif p_action = 'cancel' then
    update public.broadcast_campaigns set status = 'cancelled', finished_at = now() where id = p_id;
    update public.broadcast_recipients set status = 'skipped', error = 'Disparo cancelado' where campaign_id = p_id and status = 'pending';
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
revoke all on function public.broadcast_set_status(uuid, text) from public, anon;
grant execute on function public.broadcast_set_status(uuid, text) to authenticated;

-- ------------------------------------------------ contagens por situação
create or replace function public.broadcast_counts()
returns table (campaign_id uuid, status text, n bigint)
language sql stable set search_path = public as $$
  select r.campaign_id, r.status, count(*)
    from public.broadcast_recipients r
   where r.company_id = public.current_company_id() and public.is_admin()
   group by r.campaign_id, r.status
$$;
revoke all on function public.broadcast_counts() from public, anon;
grant execute on function public.broadcast_counts() to authenticated;

notify pgrst, 'reload schema';
