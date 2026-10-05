-- =====================================================================
-- Ajustes de cartões do dashboard:
--  * Mensagens pendentes: lista os grupos, um por linha, com quantas
--    mensagens estão pendentes e há quanto tempo o cliente espera.
--  * Novo cartão "Imagens e arquivos recebidos" (os mais recentes que os
--    clientes enviaram), que substitui "Mídias e arquivos" (desligado,
--    continua no catálogo e pode ser religado).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mensagens pendentes com lista por grupo
-- ---------------------------------------------------------------------
create or replace function public.ind_mensagens_pendentes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with pm as (select * from public.ind_pending_messages(f, p)),
  agg as (
    select count(*) as n, count(distinct group_id) as groups, count(*) filter (where overdue) as late,
           max(waiting_seconds) as longest
    from pm
  ),
  by_group as (
    select group_id, group_name, count(*)::int as n, max(waiting_seconds) as longest, bool_or(overdue) as late
    from pm group by group_id, group_name
  ),
  top as (
    select * from by_group
    order by late desc, longest desc, n desc
    limit greatest(coalesce((p->>'list_size')::int, 5), 1)
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'mensagem pendente' else 'mensagens pendentes' end,
    'tone', case when late > 0 then 'critical' when n > 0 then 'warning' else 'good' end,
    'hint', case when n = 0 then 'Todos os clientes foram respondidos'
                 else 'em ' || groups || ' grupo(s) · ' || late || ' fora do SLA · tempo = espera mais longa' end,
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id, 'value', n,
        'unit', jsonb_build_array('pendente', 'pendentes'),
        'detail', longest, 'detail_format', 'duration',
        'tone', case when late then 'critical' else 'warning' end
      ) order by late desc, longest desc, n desc)
      from top
    ), '[]'::jsonb),
    'list_more', greatest(groups - (select count(*) from top), 0)
  )
  from agg
$$;

-- tamanho da lista é um parâmetro do indicador
update public.indicators
set default_params = default_params || '{"list_size": 5}',
    params = case when params ? 'list_size' then params else params || '{"list_size": 5}' end,
    param_schema = case when param_schema @> '[{"key":"list_size"}]' then param_schema
                        else param_schema || '[{"key":"list_size","label":"Grupos listados no cartão","type":"int","min":1,"max":15}]'::jsonb end
where key = 'mensagens_pendentes';

-- ---------------------------------------------------------------------
-- Imagens e arquivos recebidos
-- ---------------------------------------------------------------------
create or replace function public.ind_received_files(f jsonb, p jsonb)
returns table (
  id uuid, group_id uuid, group_name text, who text, message_type text, body text, sent_at timestamptz, from_team boolean
)
language sql stable set search_path = public
as $$
  select m.id, m.group_id, g.name,
         coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, 'Cliente'),
         m.message_type, m.body, m.sent_at, m.from_team
  from public.ind_media(f, p) m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
  where coalesce((p->>'include_team')::boolean, false) or not m.from_team
$$;

create or replace function public.ind_arquivos_recebidos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_received_files(f, p)),
  agg as (
    select count(*)::int as n,
           count(*) filter (where message_type = 'image')::int as images,
           count(*) filter (where message_type = 'document')::int as documents,
           count(*) filter (where message_type = 'video')::int as videos,
           count(*) filter (where message_type = 'audio')::int as audios,
           count(distinct group_id)::int as groups
    from r
  ),
  latest as (
    select * from r order by sent_at desc limit greatest(coalesce((p->>'list_size')::int, 6), 1)
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'arquivo recebido' else 'arquivos recebidos' end,
    'hint', case when n = 0 then 'Nenhuma imagem ou arquivo recebido no período'
                 else 'de clientes em ' || groups || ' grupo(s) · mais recentes abaixo' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Imagens', 'value', images, 'format', 'number'),
      jsonb_build_object('label', 'Documentos', 'value', documents, 'format', 'number'),
      jsonb_build_object('label', 'Vídeos', 'value', videos, 'format', 'number'),
      jsonb_build_object('label', 'Áudios', 'value', audios, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'icon', message_type,
        'label', coalesce(nullif(btrim(body), ''),
                          case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo'
                                            when 'audio' then 'Áudio' when 'document' then 'Documento' else 'Figurinha' end),
        'sublabel', group_name || ' · ' || who,
        'group_id', group_id,
        'detail', sent_at, 'detail_format', 'datetime'
      ) order by sent_at desc)
      from latest
    ), '[]'::jsonb),
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
      jsonb_build_object('key', 'who', 'label', 'Enviado por')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'kind', case message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(body, 200), '—')
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_received_files(f, p) order by sent_at desc limit 500) x
$$;

do $$
begin
  if not exists (select 1 from public.indicators where key = 'arquivos_recebidos') then
    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('arquivos_recebidos', 'contexto_operacional', 'Imagens e arquivos recebidos',
       'Imagens, documentos, vídeos e áudios enviados pelos clientes, com os mais recentes.', 3, 'kpi', 2, false, false,
       '{"list_size": 6, "include_team": false, "include_stickers": false}',
       '[{"key":"list_size","label":"Arquivos listados no cartão","type":"int","min":1,"max":15},{"key":"include_team","label":"Contar também os enviados pela equipe","type":"bool"},{"key":"include_stickers","label":"Contar figurinhas","type":"bool"}]');
    update public.indicators set params = default_params where key = 'arquivos_recebidos';
    -- substitui o cartão antigo (continua no catálogo; o admin pode religar)
    update public.indicators set enabled = false, position = 9 where key = 'midias_arquivos';
  end if;
end $$;

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
