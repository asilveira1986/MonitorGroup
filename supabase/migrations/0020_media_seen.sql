-- =====================================================================
-- Imagens e arquivos sem visualização / sem baixa
--
-- * Cada mensagem do cliente passa a guardar quando foi vista:
--     - no WhatsApp: o celular conectado leu a conversa do grupo (o worker
--       recebe a confirmação de leitura do próprio aparelho);
--     - no painel: alguém deu baixa no arquivo.
-- * O cartão "Imagens e arquivos recebidos" passa a mostrar só os arquivos
--   que ainda ninguém viu nem deu baixa, com o botão de dar baixa.
-- =====================================================================

alter table public.messages add column if not exists seen_at  timestamptz;
alter table public.messages add column if not exists seen_via text;   -- whatsapp | painel | resposta
alter table public.messages add column if not exists seen_by  text;

create index if not exists messages_unseen_media_idx on public.messages (sent_at desc)
  where seen_at is null and not from_team and message_type in ('image', 'video', 'audio', 'document');

-- Arquivos antigos (de antes deste controle) que já tiveram resposta da equipe
-- no grupo depois de enviados contam como vistos.
do $$
begin
  if not exists (select 1 from public.messages where seen_at is not null) then
    update public.messages m
    set seen_at = x.team_at, seen_via = 'resposta'
    from (
      select c.id, (select min(e.sent_at) from public.messages e
                    where e.group_id = c.group_id and e.from_team and e.sent_at >= c.sent_at) as team_at
      from public.messages c
      where not c.from_team and c.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    ) x
    where m.id = x.id and x.team_at is not null;
  end if;
end $$;

-- Worker: o celular conectado leu a conversa do grupo até estas mensagens
-- (sem ids conhecidos, vale tudo o que chegou até p_at).
create or replace function public.mark_group_seen(
  p_instance_id uuid, p_group_jid text, p_wa_ids text[], p_at timestamptz default now()
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
  v_upto  timestamptz;
  v_n     int;
begin
  select id into v_group from public.groups where instance_id = p_instance_id and jid = p_group_jid;
  if v_group is null then
    return 0;
  end if;
  select max(sent_at) into v_upto from public.messages
  where group_id = v_group and wa_message_id = any(coalesce(p_wa_ids, '{}'));
  update public.messages
  set seen_at = coalesce(p_at, now()), seen_via = 'whatsapp', seen_by = 'Número conectado'
  where group_id = v_group and not from_team and seen_at is null
    and sent_at <= coalesce(v_upto, p_at, now());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_group_seen(uuid, text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.mark_group_seen(uuid, text, text[], timestamptz) to service_role;

-- Painel: dar baixa num arquivo (ou em todos os arquivos pendentes do grupo)
create or replace function public.mark_media_seen(p_message_id uuid default null, p_group_id uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_who text;
  v_n   int;
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  if p_message_id is null and p_group_id is null then
    raise exception 'informe a mensagem ou o grupo';
  end if;
  select coalesce(nullif(full_name, ''), email) into v_who from public.profiles where id = auth.uid();
  update public.messages
  set seen_at = now(), seen_via = 'painel', seen_by = v_who
  where seen_at is null and not from_team
    and (p_message_id is null or id = p_message_id)
    and (p_group_id is null or group_id = p_group_id)
    and (p_message_id is not null or message_type in ('image', 'video', 'audio', 'document', 'sticker'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_media_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_media_seen(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Indicador: só os arquivos sem visualização/baixa
-- ---------------------------------------------------------------------
drop function if exists public.ind_received_files(jsonb, jsonb);
create function public.ind_received_files(f jsonb, p jsonb)
returns table (
  id uuid, group_id uuid, group_name text, who text, message_type text, body text, sent_at timestamptz, from_team boolean,
  seen_at timestamptz, seen_via text, seen_by text
)
language sql stable set search_path = public
as $$
  select m.id, m.group_id, g.name,
         coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, 'Cliente'),
         m.message_type, m.body, m.sent_at, m.from_team, m.seen_at, m.seen_via, m.seen_by
  from public.messages m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
  where g.monitored and g.removed_at is null
    and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    -- fila de trabalho: os últimos N dias, independente do período do dashboard
    and m.sent_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
    and m.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    and (m.message_type <> 'sticker' or coalesce((p->>'include_stickers')::boolean, false))
    and (coalesce((p->>'include_team')::boolean, false) or not m.from_team)
$$;

create or replace function public.ind_arquivos_recebidos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_received_files(f, p)),
  u as (select * from r where seen_at is null),
  agg as (
    select (select count(*) from u)::int as n,
           (select count(*) from u where message_type = 'image')::int as images,
           (select count(*) from u where message_type = 'document')::int as documents,
           (select count(*) from u where message_type = 'video')::int as videos,
           (select count(*) from u where message_type = 'audio')::int as audios,
           (select count(distinct group_id) from u)::int as groups,
           (select count(*) from r where seen_at is not null)::int as seen,
           (select max(extract(epoch from now() - sent_at)) from u)::int as oldest
  ),
  -- os 30 mais antigos primeiro (quem espera há mais tempo); o cartão mostra list_size
  latest as (select * from u order by sent_at limit 30)
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'arquivo sem visualização' else 'arquivos sem visualização' end,
    'tone', case when n = 0 then 'good'
                 when oldest > coalesce((p->>'alert_hours')::int, 4) * 3600 then 'critical' else 'warning' end,
    'hint', case when n = 0 then 'Todos os arquivos dos últimos ' || coalesce(p->>'lookback_days', '7') || ' dias foram vistos'
                 else 'em ' || groups || ' grupo(s) · ninguém leu a conversa no WhatsApp nem deu baixa no painel' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Imagens', 'value', images, 'format', 'number'),
      jsonb_build_object('label', 'Documentos', 'value', documents, 'format', 'number'),
      jsonb_build_object('label', 'Vídeos', 'value', videos, 'format', 'number'),
      jsonb_build_object('label', 'Áudios', 'value', audios, 'format', 'number'),
      jsonb_build_object('label', 'Já vistos', 'value', seen, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'icon', message_type,
        'label', coalesce(nullif(btrim(body), ''),
                          case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo'
                                            when 'audio' then 'Áudio' when 'document' then 'Documento' else 'Figurinha' end),
        'sublabel', group_name || ' · ' || who,
        'group_id', group_id,
        'ack_id', id,
        'detail', sent_at, 'detail_format', 'datetime',
        'tone', case when extract(epoch from now() - sent_at) > coalesce((p->>'alert_hours')::int, 4) * 3600
                     then 'critical' else 'warning' end
      ) order by sent_at)
      from latest
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 6), 1),
    'list_more', greatest(n - (select count(*) from latest), 0)
  )
  from agg
$$;

create or replace function public.ind_arquivos_recebidos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Recebido em', 'format', 'datetime'),
      jsonb_build_object('key', 'kind', 'label', 'Tipo'),
      jsonb_build_object('key', 'body', 'label', 'Arquivo / legenda'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Enviado por'),
      jsonb_build_object('key', 'status', 'label', 'Situação'),
      jsonb_build_object('key', 'seen_at', 'label', 'Visto em', 'format', 'datetime'),
      jsonb_build_object('key', 'seen_by', 'label', 'Visto por')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'kind', case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(body, 200), '—'),
      'status', case when seen_at is null then 'Sem visualização'
                     when seen_via = 'whatsapp' then 'Visto no WhatsApp'
                     when seen_via = 'painel' then 'Baixa no painel'
                     else 'Equipe respondeu depois' end,
      'seen_at', seen_at, 'seen_by', seen_by
    ) order by seen_at is not null, sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_received_files(f, p) order by seen_at is not null, sent_at desc limit 500) x
$$;

update public.indicators
set name = 'Imagens e arquivos sem visualização',
    description = 'Imagens, documentos, vídeos e áudios enviados pelos clientes que ninguém viu: a conversa não foi lida no celular conectado e ninguém deu baixa no painel.',
    default_params = default_params || '{"lookback_days": 7, "alert_hours": 4}',
    params = params || jsonb_build_object(
      'lookback_days', coalesce(params->'lookback_days', '7'::jsonb),
      'alert_hours', coalesce(params->'alert_hours', '4'::jsonb)),
    param_schema = (select jsonb_agg(e) from jsonb_array_elements(param_schema) e where e->>'key' not in ('lookback_days', 'alert_hours'))
      || '[{"key":"lookback_days","label":"Considerar arquivos dos últimos","type":"int","unit":"dias","min":1,"max":60},
           {"key":"alert_hours","label":"Destacar em vermelho depois de","type":"int","unit":"horas","min":1,"max":168}]'::jsonb
where key = 'arquivos_recebidos';

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

notify pgrst, 'reload schema';
