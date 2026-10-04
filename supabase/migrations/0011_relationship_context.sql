-- =====================================================================
-- Indicadores (etapa 4): blocos 3 (Saúde do relacionamento) e
-- 4 (Contexto operacional).
--   - volume_por_grupo ganha a evolução diária de cada grupo
--   - grupos_silenciosos, cobrancas_reclamacoes, proporcao_cliente_equipe
--   - tipo_demanda, midias_arquivos
-- Regras de alerta de inatividade e de palavra-chave passam a seguir
-- os indicadores de grupos silenciosos e de cobranças/reclamações.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Busca de palavras-chave sem diferenciar acentos e maiúsculas
-- (mesma regra do worker: a palavra precisa aparecer inteira)
-- ---------------------------------------------------------------------
create or replace function public.norm_text(t text)
returns text
language sql immutable
as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

-- devolve a primeira palavra-chave encontrada no texto (ou null)
create or replace function public.match_keyword(p_text text, p_keywords jsonb)
returns text
language sql immutable set search_path = public
as $$
  select k.value
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_keywords) = 'array' then p_keywords else '[]'::jsonb end
       ) with ordinality as k(value, ord)
  where p_text is not null and btrim(k.value) <> ''
    and public.norm_text(p_text) ~ (
      '(^|[^[:alnum:]])'
      || regexp_replace(public.norm_text(btrim(k.value)), '([^[:alnum:] ])', '\\\1', 'g')
      || '($|[^[:alnum:]])')
  order by k.ord
  limit 1
$$;

-- primeira categoria cujas palavras aparecem no texto
create or replace function public.match_category(p_text text, p_categories jsonb)
returns text
language sql immutable set search_path = public
as $$
  select c.value->>'name'
  from jsonb_array_elements(
         case when jsonb_typeof(p_categories) = 'array' then p_categories else '[]'::jsonb end
       ) with ordinality as c(value, ord)
  where nullif(btrim(c.value->>'name'), '') is not null
    and public.match_keyword(p_text, c.value->'keywords') is not null
  order by c.ord
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Volume por grupo: comparação com o período anterior + evolução
-- ---------------------------------------------------------------------
create or replace function public.ind_volume_por_grupo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with bounds as (
    select (f->>'from')::timestamptz as d0, (f->>'to')::timestamptz as d1,
           (f->>'to')::timestamptz - (f->>'from')::timestamptz as len,
           ((f->>'from')::timestamptz at time zone (f->>'tz'))::date as day0,
           ((f->>'to')::timestamptz at time zone (f->>'tz'))::date as day1
  ),
  -- até 45 dias: um ponto por dia; acima disso, um ponto por semana
  buckets as (
    select b.day0 + (n * step) as bucket, n
    from bounds b,
         lateral (select case when b.day1 - b.day0 > 45 then 7 else 1 end as step) s,
         generate_series(0, (b.day1 - b.day0) / s.step) n
  ),
  scope as (select * from public.ind_scope(f)),
  prev as (
    select m.group_id, count(*) as total
    from public.messages m
    join public.groups g on g.id = m.group_id and g.monitored, bounds b
    where m.sent_at >= b.d0 - b.len and m.sent_at < b.d0
      and ((f->>'group_id') is null or m.group_id = (f->>'group_id')::uuid)
    group by m.group_id
  ),
  cur as (
    select group_id, group_name,
           count(*) filter (where not from_team) as received,
           count(*) filter (where from_team) as sent,
           count(*) as total
    from scope group by group_id, group_name
  ),
  per_bucket as (
    select s.group_id,
           (select max(bk.n) from buckets bk where bk.bucket <= (s.sent_at at time zone (f->>'tz'))::date) as n,
           count(*) as c
    from scope s group by 1, 2
  ),
  spark as (
    select c.group_id,
           jsonb_agg(coalesce(pb.c, 0) order by bk.n) as points
    from cur c cross join buckets bk
    left join per_bucket pb on pb.group_id = c.group_id and pb.n = bk.n
    group by c.group_id
  ),
  vr as (
    select c.group_id, c.group_name, c.received, c.sent, c.total, sp.points as spark,
           coalesce(pv.total, 0) as previous,
           case when coalesce(pv.total, 0) = 0 then null
                else round(100.0 * (c.total - pv.total) / pv.total, 1) end as variation
    from cur c
    left join prev pv on pv.group_id = c.group_id
    left join spark sp on sp.group_id = c.group_id
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'spark', 'label', 'Evolução', 'format', 'spark'),
      jsonb_build_object('key', 'received', 'label', 'Clientes', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'sent', 'label', 'Equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'total', 'label', 'Total', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'previous', 'label', 'Período anterior', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'variation', 'label', 'Variação', 'format', 'percent_delta', 'align', 'right',
        'highlight_abs_gte', coalesce((p->>'variation_percent')::numeric, 50))
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(vr) order by total desc) from vr), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Grupos silenciosos (situação agora, independe do período)
-- ---------------------------------------------------------------------
create or replace function public.ind_silent_groups(f jsonb, p jsonb)
returns table (group_id uuid, group_name text, last_at timestamptz, days int, last_side text, last_body text)
language sql stable set search_path = public
as $$
  select g.id, g.name, coalesce(g.last_message_at, g.created_at),
         floor(extract(epoch from now() - coalesce(g.last_message_at, g.created_at)) / 86400)::int,
         case when lm.from_team then 'Equipe' when lm.id is not null then 'Cliente' end,
         left(coalesce(lm.body, '[' || lm.message_type || ']'), 200)
  from public.groups g
  left join lateral (
    select m.id, m.from_team, m.body, m.message_type from public.messages m
    where m.group_id = g.id order by m.sent_at desc limit 1
  ) lm on true
  where g.monitored and g.removed_at is null
    and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
    and coalesce(g.last_message_at, g.created_at)
        < now() - make_interval(days => greatest(coalesce((p->>'silent_days')::int, 3), 1))
$$;

create or replace function public.ind_grupos_silenciosos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with s as (select * from public.ind_silent_groups(f, p)),
  total as (
    select count(*) as n from public.groups g
    where g.monitored and g.removed_at is null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', (select count(*) from s),
    'tone', case when (select count(*) from s) = 0 then 'good' else 'warning' end,
    'hint', 'Sem mensagens há ' || coalesce((p->>'silent_days')::int, 3) || ' dia(s) ou mais · situação agora',
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Grupos monitorados', 'value', (select n from total), 'format', 'number'),
      jsonb_build_object('label', 'Maior silêncio (dias)', 'value', (select max(days) from s), 'format', 'number'),
      jsonb_build_object('label', 'Última fala da equipe', 'value',
        (select count(*) from s where last_side = 'Equipe'), 'format', 'number')
    )
  )
$$;

create or replace function public.ind_grupos_silenciosos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'last_at', 'label', 'Última mensagem', 'format', 'datetime'),
      jsonb_build_object('key', 'days', 'label', 'Dias sem mensagem', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'last_side', 'label', 'Quem falou por último'),
      jsonb_build_object('key', 'last_body', 'label', 'Última mensagem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name, 'last_at', last_at, 'days', days,
      'last_side', coalesce(last_side, '—'), 'last_body', coalesce(last_body, '—')
    ) order by days desc), '[]'::jsonb)
  )
  from public.ind_silent_groups(f, p)
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Cobranças e reclamações
-- ---------------------------------------------------------------------
create or replace function public.ind_complaints(f jsonb, p jsonb)
returns table (id uuid, group_id uuid, group_name text, who text, body text, sent_at timestamptz, keyword text)
language sql stable set search_path = public
as $$
  select * from (
    select s.id, s.group_id, s.group_name, coalesce(s.sender_name, s.sender_phone, 'Cliente'), s.body, s.sent_at,
           public.match_keyword(s.body, p->'keywords') as keyword
    from public.ind_scope(f) s
    where not s.from_team and s.body is not null
  ) x where keyword is not null
$$;

create or replace function public.ind_cobrancas_reclamacoes(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (select * from public.ind_complaints(f, p)),
  clients as (select count(*) as n from public.ind_scope(f) where not from_team),
  top_kw as (select keyword, count(*) as n from c group by 1 order by 2 desc limit 1),
  trend as (
    select to_char((sent_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as value
    from c group by 1 order by 1
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', (select count(*) from c),
    'tone', case when (select count(*) from c) = 0 then 'good' else 'warning' end,
    'hint', coalesce('Mais frequente: "' || (select keyword from top_kw) || '"', 'Nenhuma mensagem de cobrança ou insatisfação'),
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Grupos', 'value', (select count(distinct group_id) from c), 'format', 'number'),
      jsonb_build_object('label', 'Das mensagens de clientes', 'value',
        case when (select n from clients) = 0 then null
             else round(100.0 * (select count(*) from c) / (select n from clients), 1) end, 'format', 'percent')
    ),
    'trend', jsonb_build_object('format', 'number',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
$$;

create or replace function public.ind_cobrancas_reclamacoes_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Data', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Cliente'),
      jsonb_build_object('key', 'keyword', 'label', 'Palavra'),
      jsonb_build_object('key', 'body', 'label', 'Mensagem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', sent_at, 'group_id', group_id, 'group_name', group_name, 'who', who,
      'keyword', keyword, 'body', left(body, 200)
    ) order by sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_complaints(f, p) order by sent_at desc limit 500) x
$$;

-- ---------------------------------------------------------------------
-- Bloco 3 — Proporção cliente x equipe
-- ---------------------------------------------------------------------
create or replace function public.ind_proporcao_cliente_equipe(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with g as (
    select group_id, group_name,
           count(*) filter (where not from_team) as clients,
           count(*) filter (where from_team) as team
    from public.ind_scope(f) group by group_id, group_name
  ),
  r as (
    select *, case when clients = 0 then null else round(100.0 * team / clients) end as ratio from g
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'clients', 'label', 'Clientes', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'team', 'label', 'Equipe', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'ratio', 'label', 'Equipe a cada 100', 'format', 'number', 'align', 'right',
        'warn_below', coalesce((p->>'min_team_percent')::numeric, 50))
    ),
    -- grupos com a equipe menos presente primeiro
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by ratio asc nulls last, clients desc) from r), '[]'::jsonb)
  )
$$;

create or replace function public.ind_proporcao_cliente_equipe_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_messages_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Bloco 4 — Tipo de demanda
-- ---------------------------------------------------------------------
create or replace function public.ind_tipo_demanda(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with cats as (
    select c.value->>'name' as name, c.ord
    from jsonb_array_elements(coalesce(p->'categories', '[]'::jsonb)) with ordinality c(value, ord)
    where nullif(btrim(c.value->>'name'), '') is not null
  ),
  d as (select coalesce(nullif(btrim(type), ''), 'Sem tipo') as name, count(*) as n
        from public.ind_demand_scope(f) where status <> 'cancelada' group by 1),
  m as (
    select public.match_category(body, p->'categories') as name, count(*) as n
    from public.ind_scope(f)
    where not from_team and message_type = 'text' and body is not null
    group by 1
  ),
  labels as (
    select name, ord from cats
    union all
    select name, 1000 from d where name not in (select name from cats) and name <> 'Sem tipo'
    union all
    select 'Sem tipo', 2000 where exists (select 1 from d where name = 'Sem tipo')
  )
  -- tabela (e não gráfico): demandas e mensagens têm escalas muito diferentes
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'label', 'label', 'Categoria'),
      jsonb_build_object('key', 'demands', 'label', 'Demandas', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'messages', 'label', 'Mensagens', 'format', 'number', 'align', 'right', 'bar', true)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', l.name,
        'demands', coalesce((select n from d where d.name = l.name), 0),
        'messages', coalesce((select n from m where m.name = l.name), 0)
      ) order by l.ord, l.name)
      from labels l
    ), '[]'::jsonb)
  )
$$;

create or replace function public.ind_tipo_demanda_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'number', 'label', '#', 'format', 'number', 'link_demand', true),
      jsonb_build_object('key', 'opened_at', 'label', 'Aberta em', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'type', 'label', 'Tipo'),
      jsonb_build_object('key', 'description', 'label', 'Demanda'),
      jsonb_build_object('key', 'source', 'label', 'Origem')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'demand_id', id, 'number', number, 'opened_at', opened_at, 'group_id', group_id, 'group_name', group_name,
      'type', coalesce(nullif(btrim(type), ''), 'Sem tipo'), 'description', left(description, 200),
      'source', case source when 'manual' then 'Manual' when 'ai' then 'IA' else 'Comando/palavra-chave' end
    ) order by opened_at desc), '[]'::jsonb)
  )
  from public.ind_demand_scope(f)
  where status <> 'cancelada'
$$;

-- ---------------------------------------------------------------------
-- Bloco 4 — Mídias e arquivos (por grupo e remetente)
-- ---------------------------------------------------------------------
create or replace function public.ind_media(f jsonb, p jsonb)
returns setof public.messages
language sql stable set search_path = public
as $$
  select m.* from public.messages m
  where m.id in (select s.id from public.ind_scope(f) s)
    and m.message_type in ('image', 'video', 'audio', 'document', 'sticker')
    and (m.message_type <> 'sticker' or coalesce((p->>'include_stickers')::boolean, false))
$$;

create or replace function public.ind_midias_arquivos(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with x as (
    select m.group_id, g.name as group_name,
           coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, '—') as who,
           case when m.from_team then 'Equipe' else 'Cliente' end as side,
           m.message_type
    from public.ind_media(f, p) m
    join public.groups g on g.id = m.group_id
    left join public.team_members tm on tm.id = m.team_member_id
  ),
  r as (
    select group_id, group_name, who, side,
           count(*) filter (where message_type = 'image') as images,
           count(*) filter (where message_type = 'video') as videos,
           count(*) filter (where message_type = 'audio') as audios,
           count(*) filter (where message_type = 'document') as documents,
           count(*) filter (where message_type = 'sticker') as stickers,
           count(*) as total
    from x group by 1, 2, 3, 4
    order by total desc limit 100
  )
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Remetente'),
      jsonb_build_object('key', 'side', 'label', 'Lado'),
      jsonb_build_object('key', 'images', 'label', 'Imagens', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'videos', 'label', 'Vídeos', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'audios', 'label', 'Áudios', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'documents', 'label', 'Documentos', 'format', 'number', 'align', 'right')
    ) || case when coalesce((p->>'include_stickers')::boolean, false)
              then jsonb_build_array(jsonb_build_object('key', 'stickers', 'label', 'Figurinhas', 'format', 'number', 'align', 'right'))
              else '[]'::jsonb end
      || jsonb_build_array(jsonb_build_object('key', 'total', 'label', 'Total', 'format', 'number', 'align', 'right', 'bar', true)),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by total desc) from r), '[]'::jsonb)
  )
$$;

create or replace function public.ind_midias_arquivos_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'sent_at', 'label', 'Data', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'who', 'label', 'Remetente'),
      jsonb_build_object('key', 'kind', 'label', 'Tipo'),
      jsonb_build_object('key', 'body', 'label', 'Arquivo / legenda')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sent_at', m.sent_at, 'group_id', m.group_id, 'group_name', g.name,
      'who', coalesce(tm.name, m.sender_name, m.sender_phone, case when m.from_me then 'Número conectado' end, '—'),
      'kind', case m.message_type when 'image' then 'Imagem' when 'video' then 'Vídeo' when 'audio' then 'Áudio'
                                  when 'document' then 'Documento' else 'Figurinha' end,
      'body', coalesce(left(m.body, 200), '—')
    ) order by m.sent_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_media(f, p) order by sent_at desc limit 500) m
  join public.groups g on g.id = m.group_id
  left join public.team_members tm on tm.id = m.team_member_id
$$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
insert into public.indicators
  (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
   default_params, param_schema)
values
  ('grupos_silenciosos', 'saude_relacionamento', 'Grupos silenciosos',
   'Grupos monitorados sem nenhuma mensagem há alguns dias.', 1, 'kpi', 1, true, true,
   '{"silent_days": 3}',
   '[{"key":"silent_days","label":"Dias sem mensagem","type":"int","unit":"dias","min":1,"max":365,"help":"As regras de alerta de inatividade com o mesmo prazo acompanham este valor."}]'),
  ('cobrancas_reclamacoes', 'saude_relacionamento', 'Cobranças e reclamações',
   'Mensagens de clientes com tom de cobrança ou insatisfação.', 2, 'kpi', 1, true, true,
   '{"keywords": ["urgente", "reclamação", "cancelar", "procon", "absurdo", "insatisfeito", "péssimo", "ninguém responde", "até quando", "cadê", "descaso", "demora"]}',
   '[{"key":"keywords","label":"Palavras-chave","type":"tags","help":"As regras de alerta de palavra-chave com a mesma lista acompanham as mudanças."}]'),
  ('proporcao_cliente_equipe', 'saude_relacionamento', 'Proporção cliente x equipe',
   'Mensagens da equipe para cada 100 mensagens de clientes, por grupo.', 3, 'table', 1, false, false,
   '{"min_team_percent": 50}',
   '[{"key":"min_team_percent","label":"Destacar grupos abaixo de","type":"int","unit":"msgs da equipe a cada 100","min":1,"max":1000}]'),
  ('tipo_demanda', 'contexto_operacional', 'Tipo de demanda',
   'Demandas abertas e mensagens de clientes por categoria (dúvida, erro, pedido novo, financeiro).', 2, 'table', 1, false, false,
   '{"categories": [{"name": "Financeiro", "keywords": ["boleto", "nota fiscal", "pagamento", "fatura", "cobrança", "pix", "reembolso"]}, {"name": "Erro", "keywords": ["erro", "não funciona", "bug", "travou", "problema", "parou", "falha"]}, {"name": "Dúvida", "keywords": ["dúvida", "como faço", "como funciona", "pergunta", "saber se"]}, {"name": "Pedido novo", "keywords": ["solicito", "preciso de", "gostaria", "orçamento", "pedido", "novo"]}]}',
   '[{"key":"categories","label":"Categorias","type":"categories","help":"A primeira categoria cujas palavras aparecem na mensagem vence. Também usadas como tipos das demandas."}]'),
  ('midias_arquivos', 'contexto_operacional', 'Mídias e arquivos',
   'Imagens, vídeos, áudios e documentos enviados, por grupo e remetente.', 3, 'table', 2, false, false,
   '{"include_stickers": false}',
   '[{"key":"include_stickers","label":"Contar figurinhas","type":"bool"}]')
on conflict (key) do update set visual = excluded.visual, description = excluded.description;

update public.indicators set params = default_params, enabled = default_enabled, alert_enabled = default_alert_enabled
where key in ('grupos_silenciosos', 'cobrancas_reclamacoes', 'proporcao_cliente_equipe', 'tipo_demanda', 'midias_arquivos')
  and updated_by is null and params = '{}'::jsonb;

-- volume por grupo vai para o fim do bloco, em largura total (tem a coluna de evolução)
update public.indicators set position = 4, size = 3 where key = 'volume_por_grupo' and updated_by is null;

-- ---------------------------------------------------------------------
-- Alertas: inatividade -> grupos silenciosos; palavra-chave -> cobranças
-- ---------------------------------------------------------------------
update public.alert_rules set indicator_key = 'grupos_silenciosos'
where type = 'inactivity' and indicator_key is null;
update public.alert_rules set indicator_key = 'cobrancas_reclamacoes'
where type = 'keyword' and indicator_key is null;

insert into public.alert_rules (name, type, severity, threshold_minutes, cooldown_minutes, indicator_key)
select 'Grupo silencioso', 'inactivity', 'warning', 3 * 1440, 1440, 'grupos_silenciosos'
where not exists (select 1 from public.alert_rules where type = 'inactivity');

-- a regra de palavras críticas original passa a usar a lista do indicador
update public.alert_rules r
set keywords = array(select jsonb_array_elements_text(i.params->'keywords')), updated_at = now()
from public.indicators i
where i.key = 'cobrancas_reclamacoes' and r.type = 'keyword'
  and r.keywords = array['urgente', 'reclamação', 'cancelar', 'procon', 'absurdo'];

-- mudar o parâmetro do indicador atualiza as regras que usavam o valor anterior
create or replace function public.sync_indicator_alert_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.key = 'grupos_silenciosos' and (new.params->>'silent_days') is not null
     and (new.params->'silent_days') is distinct from (old.params->'silent_days') then
    update public.alert_rules
    set threshold_minutes = (new.params->>'silent_days')::int * 1440, updated_at = now()
    where indicator_key = 'grupos_silenciosos' and type = 'inactivity'
      and threshold_minutes = coalesce((old.params->>'silent_days')::int, 3) * 1440;
  end if;
  if new.key = 'cobrancas_reclamacoes' and jsonb_typeof(new.params->'keywords') = 'array'
     and (new.params->'keywords') is distinct from (old.params->'keywords') then
    update public.alert_rules
    set keywords = array(select jsonb_array_elements_text(new.params->'keywords')), updated_at = now()
    where indicator_key = 'cobrancas_reclamacoes' and type = 'keyword'
      and keywords = array(select jsonb_array_elements_text(coalesce(old.params->'keywords', '[]'::jsonb)));
  end if;
  return new;
end;
$$;

drop trigger if exists indicators_sync_alert_rules on public.indicators;
create trigger indicators_sync_alert_rules after update on public.indicators
  for each row execute function public.sync_indicator_alert_rules();

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
