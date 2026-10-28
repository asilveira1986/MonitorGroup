-- =====================================================================
-- Dashboard mais rápido.
--
--  * Busca por palavras (pergunta, pedido, urgência, agradecimento,
--    encerramento, categorias): a expressão de cada lista é montada uma
--    vez, e não a cada mensagem; as funções ficam em SQL simples para o
--    banco embutir na consulta. O resultado é o mesmo de antes.
--  * Tipo de demanda: a contagem das mensagens por categoria era refeita
--    para cada categoria; agora é feita uma vez.
--  * Conversas (início e fechamento, conversas por dia, resumo da
--    gestão): a lista de conversas do período é calculada uma vez por
--    carregamento e reaproveitada; a classificação das mensagens vai na
--    própria consulta.
--  * Horários de pico e dia hora a hora: contagens feitas de uma vez.
--  * Cada indicador é calculado uma vez por carregamento (os
--    indicadores e o resumo da gestão usam os mesmos números).
--  * dashboard_bundle(): indicadores + resumo da gestão de um período
--    numa chamada só (o painel faz 2 chamadas em vez de 4); a do período
--    de comparação calcula só os números.
--  * Índice para achar a última mensagem da equipe em cada grupo.
-- =====================================================================

create index if not exists messages_group_team_sent_idx on public.messages (group_id, sent_at desc) where from_team;

-- ------------------------------------------------ busca por palavras
-- expressão com todas as palavras de uma lista (null = lista vazia). Montada uma vez por lista e
-- guardada na sessão (a chave é o conteúdo da lista: mudou a lista, muda a chave); dentro de uma
-- consulta com a lista fixa, o banco calcula uma vez só.
create or replace function public.kw_pattern(p_keywords jsonb)
returns text language plpgsql immutable as $$
declare
  v_key text;
  v_alt text;
begin
  if jsonb_typeof(p_keywords) is distinct from 'array' or jsonb_array_length(p_keywords) = 0 then
    return null;
  end if;
  v_key := 'mgkw.k' || md5(p_keywords::text);
  v_alt := current_setting(v_key, true);
  if v_alt is null or v_alt = '' then
    select string_agg(regexp_replace(public.norm_text(btrim(e.value)), '([^[:alnum:] ])', '\\\1', 'g'), '|')
      into v_alt
      from jsonb_array_elements(p_keywords) as x(item), lateral (select x.item #>> '{}' as value) e
     where jsonb_typeof(x.item) = 'string' and btrim(e.value) <> '';
    v_alt := case when v_alt is null then '-' else '(^|[^[:alnum:]])(' || v_alt || ')($|[^[:alnum:]])' end;
    perform set_config(v_key, v_alt, false);
  end if;
  return nullif(v_alt, '-');
end;
$$;

-- a palavra da lista que aparece primeiro na ordem da lista (só é chamada quando alguma aparece)
create or replace function public.match_keyword_first(p_text text, p_keywords jsonb)
returns text language plpgsql immutable as $$
declare
  v_text text := public.norm_text(p_text);
  k record;
begin
  for k in
    select e.value
    from jsonb_array_elements_text(p_keywords) with ordinality as e(value, ord)
    where btrim(e.value) <> ''
    order by e.ord
  loop
    if v_text ~ ('(^|[^[:alnum:]])'
                 || regexp_replace(public.norm_text(btrim(k.value)), '([^[:alnum:] ])', '\\\1', 'g')
                 || '($|[^[:alnum:]])') then
      return k.value;
    end if;
  end loop;
  return null;
end;
$$;

-- qual palavra da lista aparece no texto (sem acento e sem diferença de maiúsculas; palavra inteira).
-- Em SQL simples (sem search_path próprio) para o banco embutir na consulta: a maioria das mensagens
-- para no primeiro teste.
create or replace function public.match_keyword(p_text text, p_keywords jsonb)
returns text language sql immutable as $$
  select case
    when p_text is null or public.kw_pattern(p_keywords) is null then null
    when public.norm_text(p_text) !~ public.kw_pattern(p_keywords) then null
    else public.match_keyword_first(p_text, p_keywords)
  end
$$;

-- expressão com as palavras de todas as categorias (guardada na sessão, como em kw_pattern)
create or replace function public.category_pattern(p_categories jsonb)
returns text language plpgsql immutable as $$
declare
  v_key text;
  v_all jsonb;
  v_pat text;
begin
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories) = 0 then
    return null;
  end if;
  v_key := 'mgkw.c' || md5(p_categories::text);
  v_pat := current_setting(v_key, true);
  if v_pat is null or v_pat = '' then
    select coalesce(jsonb_agg(k.value), '[]'::jsonb) into v_all
      from jsonb_array_elements(p_categories) cat(value),
           jsonb_array_elements(case when jsonb_typeof(cat.value->'keywords') = 'array' then cat.value->'keywords' else '[]'::jsonb end) k(value)
     where nullif(btrim(cat.value->>'name'), '') is not null and jsonb_typeof(k.value) = 'string';
    v_pat := coalesce(public.kw_pattern(v_all), '-');
    perform set_config(v_key, v_pat, false);
  end if;
  return nullif(v_pat, '-');
end;
$$;

create or replace function public.match_category_first(p_text text, p_categories jsonb)
returns text language sql immutable as $$
  select c.value->>'name'
  from jsonb_array_elements(p_categories) with ordinality as c(value, ord)
  where nullif(btrim(c.value->>'name'), '') is not null
    and public.match_keyword(p_text, c.value->'keywords') is not null
  order by c.ord
  limit 1
$$;

-- a primeira categoria (na ordem da lista) com alguma palavra no texto; antes, um teste só com as
-- palavras de todas as categorias
create or replace function public.match_category(p_text text, p_categories jsonb)
returns text language sql immutable as $$
  select case
    when p_text is null or public.category_pattern(p_categories) is null then null
    when public.norm_text(p_text) !~ public.category_pattern(p_categories) then null
    else public.match_category_first(p_text, p_categories)
  end
$$;

create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $$
  select case
    when p_type in ('sticker', 'reaction') then 'closing'
    when p_type = 'audio' then 'audio'
    when nullif(btrim(coalesce(p_body, '')), '') is null then
      case when p_type in ('image', 'video', 'document') then 'media' else 'plain' end
    when public.match_keyword(p_body, p->'urgent_keywords') is not null then 'urgent'
    when p_body ~ '[?¿]'
      or public.norm_text(btrim(p_body)) ~ ('^(quem|qual|quais|quando|onde|como|quanto|quantos|quantas|por que|porque|pq|'
           || 'sera que|alguem|voces|vcs|tem como|teria como|consegue|conseguem|poderia|poderiam|pode(?! deixar)|podem|'
           || 'da pra|da para|e possivel|seria possivel|existe|ha como|tem previsao)([^[:alnum:]]|$)') then 'question'
    when public.match_keyword(p_body, p->'request_keywords') is not null then 'request'
    when public.norm_text(btrim(p_body)) ~ ('^(bom dia|boa tarde|boa noite|oi+|ola|opa|e ai|salve|oie)'
           || '([ ,!.]+(pessoal|a todos|todos|gente|galera|tudo bem|tudo bom|como vai))*[ !.,]*$') then 'greeting'
    when public.match_keyword(p_body, p->'closing_keywords') is not null and length(btrim(p_body)) <= 80 then 'closing'
    -- só emojis/pontuação
    when p_body !~ '[[:alnum:]]' then 'closing'
    -- risadas
    when public.norm_text(btrim(p_body)) ~ '^((k|ha|he|hi|rs|ks)+[ !.]*)+$' then 'social'
    else 'plain'
  end
$$;

create or replace function public.team_close_kind(p_body text, p jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $$
  select case
    when nullif(btrim(coalesce(p_body, '')), '') is null then null
    when public.match_keyword(p_body, p->'commitment_keywords') is not null then 'compromisso'
    when public.match_keyword(p_body, p->'team_closing_keywords') is not null then 'encerramento'
  end
$$;

-- ------------------------------------------------ tipo de demanda
create or replace function public.ind_tipo_demanda(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with cats as (
    select c.value->>'name' as name, c.ord
    from jsonb_array_elements(coalesce(p->'categories', '[]'::jsonb)) with ordinality c(value, ord)
    where nullif(btrim(c.value->>'name'), '') is not null
  ),
  d as materialized (select coalesce(nullif(btrim(type), ''), 'Sem tipo') as name, count(*) as n
        from public.ind_demand_scope(f) where status <> 'cancelada' group by 1),
  -- uma vez só (sem "materialized", a contagem era refeita para cada categoria)
  m as materialized (
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

-- ------------------------------------------------ horários de pico e dia hora a hora: contagens de uma vez
create or replace function public.ind_horarios_pico(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with m as materialized (
    select extract(isodow from sent_at at time zone (f->>'tz'))::int as dw,   -- 1 = segunda ... 7 = domingo
           extract(hour from sent_at at time zone (f->>'tz'))::int as hr,
           public.is_business_time(sent_at, f) as in_business
    from public.ind_scope(f) where not from_team
  ),
  days as (
    select d, (array['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])[d] as short,
           (array['segunda','terça','quarta','quinta','sexta','sábado','domingo'])[d] as long
    from generate_series(1, 7) d
  ),
  -- contadas de uma vez (antes, uma contagem por dia e hora)
  cnt as (select dw, hr, count(*)::int as n from m group by dw, hr),
  grid as (
    select days.d, hs.h, coalesce(cnt.n, 0) as n
    from days cross join generate_series(0, 23) as hs(h)
    left join cnt on cnt.dw = days.d and cnt.hr = hs.h
  ),
  by_hour as (select h, sum(n)::int as n from grid group by h),
  by_day as (select d, sum(n)::int as n from grid group by d),
  tot as (select count(*)::int as n, count(*) filter (where not in_business)::int as outside from m),
  -- pico = hora do dia com mais mensagens somando todos os dias (o mesmo destacado no gráfico)
  peak as (select h, n from by_hour order by n desc, h limit 1),
  peak_hour_day as (
    select g.d from grid g, peak where g.h = peak.h order by g.n desc, g.d limit 1
  ),
  peak_day as (select d, n from by_day order by n desc, d limit 1),
  -- faixa de 2 horas seguidas mais movimentada (no dia típico)
  peak_window as (
    select h, n + coalesce((select b2.n from by_hour b2 where b2.h = b1.h + 1), 0) as n2
    from by_hour b1 where h < 23 order by 2 desc, h limit 1
  ),
  bh as (
    select extract(hour from (f->>'business_start')::time)::int as start_h,
           ceil(extract(epoch from (f->>'business_end')::time) / 3600)::int as end_h
  )
  select jsonb_build_object(
    'visual', 'heatmap',
    'rows', (select jsonb_agg(short order by d) from days),
    'cols', (select jsonb_agg(lpad(h::text, 2, '0') || 'h' order by h) from generate_series(0, 23) h),
    'values', (select jsonb_agg(r order by d) from (select d, jsonb_agg(n order by h) as r from grid group by d) x),
    'total', (select n from tot),
    'by_hour', (select jsonb_agg(jsonb_build_object('label', lpad(h::text, 2, '0') || 'h', 'value', n) order by h) from by_hour),
    'by_day', (select jsonb_agg(jsonb_build_object('label', days.short, 'value', by_day.n) order by days.d)
               from by_day join days using (d)),
    'business', (select jsonb_build_object('start_hour', start_h, 'end_hour', end_h,
                   'days', coalesce(f->'business_days', '[]'::jsonb)) from bh),
    'highlights', case when (select n from tot) = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'label', 'Horário de pico',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 1)::text, 2, '0') || 'h' from peak),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens · mais forte ' ||
                          (select case when days.d in (6, 7) then 'no ' else 'na ' end || days.long from peak_hour_day join days using (d))
                   from peak)),
      jsonb_build_object(
        'label', 'Faixa mais movimentada',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 2)::text, 2, '0') || 'h' from peak_window),
        'detail', (select round(100.0 * n2 / nullif((select n from tot), 0)) || '% das mensagens do período' from peak_window)),
      jsonb_build_object(
        'label', 'Dia mais movimentado',
        'value', (select initcap(days.long) from peak_day join days using (d)),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens' from peak_day)),
      jsonb_build_object(
        'label', 'Fora do expediente',
        'value', (select round(100.0 * outside / nullif(n, 0)) || '%' from tot),
        'detail', (select outside || ' de ' || n || ' mensagens' from tot),
        'tone', (select case when 100.0 * outside / nullif(n, 0) >= 30 then 'warning' end from tot))
    ) end,
    'hint', case when (select n from tot) = 0 then 'Sem mensagens de clientes no período'
                 else (select n || ' mensagens de clientes no período' from tot) end
  )
$$;

create or replace function public.ind_dia_hora_a_hora(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with s as (select * from public.ind_slots(f)),
  -- mensagens de cliente no período, com quando a equipe respondeu no grupo
  c as materialized (
    select m.sent_at at time zone (f->>'tz') as lt,
           (select min(t.sent_at) from public.messages t
             where t.group_id = m.group_id and t.from_team and t.sent_at >= m.sent_at) at time zone (f->>'tz') as ans_lt,
           m.opens_pending
    from public.ind_scope(f) m
    where not m.from_team
  ),
  -- respostas da equipe (as mesmas de ind_responses, só com a hora: sem calcular o horário comercial de cada uma)
  r as materialized (
    select m.sent_at at time zone (f->>'tz') as lt
    from public.ind_scope(f) m
    where m.from_team and m.response_time_seconds is not null
      and ((f->>'member_id') is null or m.team_member_id = (f->>'member_id')::uuid)
  ),
  rc as (select s.t0, count(r.lt)::int as n from public.ind_slots(f) s left join r on r.lt >= s.t0 and r.lt < s.t1 group by s.t0),
  cc as (select s.t0, count(c.lt)::int as n from public.ind_slots(f) s left join c on c.lt >= s.t0 and c.lt < s.t1 group by s.t0),
  v as (
    select s.x, s.t0, s.hourly,
           (select n from cc where cc.t0 = s.t0) as received,
           (select n from rc where rc.t0 = s.t0) as answered,
           -- pendentes ao fim da faixa (ou agora, na faixa em andamento)
           (select count(*) from c where c.opens_pending and c.lt < s.t1
                                     and (c.ans_lt is null or c.ans_lt >= least(s.t1, now() at time zone (f->>'tz'))))::int as pending
    from s
  ),
  peak as (select x, received from v order by received desc, t0 limit 1)
  select jsonb_build_object(
    -- um dia: barras por hora; vários dias: linha por dia
    'visual', case when (select hourly from v limit 1) then 'bars' else 'series' end,
    'format', 'number',
    'hint', case when (select sum(received) from v) = 0 then 'Nenhuma mensagem de cliente no período'
                 else 'Pico: ' || (select case when (select hourly from v limit 1) then x else to_char(x::date, 'DD/MM') end from peak)
                      || ' (' || (select received from peak) || ' recebidas) · '
                      || (select sum(received) from v) || ' recebidas · ' || (select sum(answered) from v) || ' respostas' end,
    'series', jsonb_build_array(
      jsonb_build_object('key', 'received', 'label', 'Recebidas'),
      jsonb_build_object('key', 'answered', 'label', 'Respostas da equipe'),
      jsonb_build_object('key', 'pending', 'label', case when (select hourly from v limit 1)
                                                         then 'Pendentes no fim da hora' else 'Pendentes no fim do dia' end)
    ),
    'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'label', x, 'received', received, 'answered', answered, 'pending', pending)
                                       order by t0) from v), '[]'::jsonb)
  )
$$;

-- ------------------------------------------------ conversas: calculadas uma vez por carregamento
create or replace function public.ind_conversations_calc(f jsonb, p jsonb)
 RETURNS TABLE(group_id uuid, group_name text, started_at timestamp with time zone, started_by text, starter text, start_body text, first_team_at timestamp with time zone, status text, closed_at timestamp with time zone, closed_by text, closer text, close_body text, last_at timestamp with time zone, msgs integer, returned_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  -- palavras de pergunta/pedido/urgência/encerramento do cliente vêm da análise "Precisa de resposta?"
  v_sig_p jsonb := coalesce((select i.params from public.my_indicators i where i.key = 'analise_sem_resposta'), '{}'::jsonb)
                   || case when jsonb_typeof(p->'client_closing_keywords') = 'array'
                                and jsonb_array_length(p->'client_closing_keywords') > 0
                           then jsonb_build_object('closing_keywords', p->'client_closing_keywords') else '{}'::jsonb end;
  v_idle interval := make_interval(hours => coalesce((p->>'idle_hours')::int, 24));
  v_team_starts boolean := coalesce((p->>'team_can_start')::boolean, true);
  m record;
  v_group uuid := null;
  v_open boolean := false;
  v_sig text;
  v_kind text;
  -- o grupo tem compromisso de retorno ainda não cumprido (a próxima mensagem da equipe é o retorno)
  v_awaiting_return boolean := false;
begin
  for m in
    select s.group_id as gid, s.group_name as gname, s.from_team, s.body, s.message_type, s.sent_at,
           coalesce(tm.name, s.sender_name, s.sender_phone, case when s.from_me then 'Número conectado' end,
                    case when s.from_team then 'Equipe' else 'Cliente' end) as who,
           -- a classificação de cada mensagem vai na própria consulta (bem mais rápido que uma a uma no laço)
           case when s.from_team then public.team_close_kind(s.body, p) end as kind,
           case when not s.from_team then public.reply_signal(s.body, s.message_type, v_sig_p) end as sig
    from public.ind_scope(f) s
    left join public.team_members tm on tm.id = s.team_member_id
    order by s.group_id, s.sent_at
  loop
    -- mudou de grupo: a conversa aberta do grupo anterior termina como está
    if v_group is distinct from m.gid then
      if v_open then
        status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
        return next;
      end if;
      v_group := m.gid;
      v_open := false;
      v_awaiting_return := false;
    end if;

    -- grupo parado além do limite: a conversa ficou sem fechamento
    if v_open and m.sent_at - last_at > v_idle then
      status := 'sem_fechamento';
      return next;
      v_open := false;
    end if;

    v_kind := m.kind;
    v_sig := m.sig;

    if not v_open then
      -- a primeira mensagem da equipe depois de um compromisso é o retorno, não uma conversa nova
      if v_awaiting_return then
        v_awaiting_return := false;
        if m.from_team then
          continue;
        end if;
      end if;
      -- começa uma conversa: mensagem do cliente que não seja agradecimento/risada,
      -- ou da equipe (se permitido) que não seja encerramento/compromisso
      if (not m.from_team and v_sig not in ('closing', 'social'))
         or (m.from_team and v_team_starts and v_kind is null) then
        v_open := true;
        group_id := m.gid; group_name := m.gname; started_at := m.sent_at;
        started_by := case when m.from_team then 'equipe' else 'cliente' end;
        starter := m.who; start_body := m.body;
        first_team_at := case when m.from_team then m.sent_at end;
        closed_at := null; closed_by := null; closer := null; close_body := null; returned_at := null;
        last_at := m.sent_at; msgs := 1;
      end if;
      continue;
    end if;

    msgs := msgs + 1;
    last_at := m.sent_at;
    if m.from_team and first_team_at is null and started_by = 'cliente' then
      first_team_at := m.sent_at;
    end if;

    if (m.from_team and v_kind is not null)
       -- o cliente encerra depois de a equipe ter participado (ou numa conversa iniciada pela equipe)
       or (not m.from_team and v_sig = 'closing' and (first_team_at is not null or started_by = 'equipe')) then
      status := case when v_kind = 'compromisso' then 'compromisso' else 'encerrada' end;
      closed_at := m.sent_at;
      closed_by := case when m.from_team then 'equipe' else 'cliente' end;
      closer := m.who;
      close_body := m.body;
      if status = 'compromisso' then
        -- a equipe voltou a falar no grupo depois do compromisso?
        select min(x.sent_at) into returned_at from public.messages x
        where x.group_id = m.gid and x.from_team and x.sent_at > m.sent_at;
      end if;
      return next;
      v_open := false;
      v_awaiting_return := status = 'compromisso';
    end if;
  end loop;

  if v_open then
    status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
    return next;
  end if;
end;
$$;

create or replace function public.ind_conversations(f jsonb, p jsonb)
returns table(group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text, first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text, last_at timestamptz, msgs integer, returned_at timestamptz)
language plpgsql stable set search_path = public as $$
declare
  -- guardada só durante o carregamento (transação) de quem pediu
  v_key text := 'mgconv.k' || md5(f::text || '|' || coalesce(p::text, '') || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)::text into v from public.ind_conversations_calc(f, p) c;
    perform set_config(v_key, v, true);
  end if;
  return query select * from jsonb_to_recordset(v::jsonb) as x(group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text, first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text, last_at timestamptz, msgs integer, returned_at timestamptz);
end;
$$;

-- ------------------------------------------------ cada indicador uma vez por carregamento
create or replace function public.ind_cached(p_key text, f jsonb, p jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_name text := 'mgind.k' || md5(p_key || '|' || f::text || '|' || coalesce(p::text, '') || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_name, true);
  d jsonb;
begin
  if v is not null and v <> '' then
    return nullif(v, 'null')::jsonb;
  end if;
  execute format('select public.%I($1, $2)', 'ind_' || p_key) into d using f, p;
  perform set_config(v_name, coalesce(d::text, 'null'), true);
  return d;
end;
$$;
revoke all on function public.ind_cached(text, jsonb, jsonb) from public, anon;
grant execute on function public.ind_cached(text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.indicator_values(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  v_f      jsonb;
  v_ind    record;
  v_data   jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  for v_ind in
    select i.*, b.name as block_name, b.position as block_position
    from public.my_indicators i join public.my_indicator_blocks b on b.key = i.block_key
    where i.enabled and b.enabled
      -- comparação do dashboard (dashboard_bundle "só números"): só os indicadores de número
      and (current_setting('mg.kpi_only', true) is distinct from 'on' or i.visual = 'kpi')
    order by b.position, i.position
  loop
    begin
      v_data := public.ind_cached(v_ind.key, v_f, v_ind.params);
    exception when others then
      v_data := jsonb_build_object('visual', 'error', 'message', sqlerrm);
    end;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'key', v_ind.key, 'name', v_ind.name, 'description', v_ind.description,
      'block_key', v_ind.block_key, 'block_name', v_ind.block_name,
      'size', v_ind.size, 'has_details', v_ind.has_details, 'data', v_data
    ));
  end loop;

  return v_result;
end;
$$;

create or replace function public.management_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  f      jsonb;
  v_kpi  jsonb := '{}'::jsonb;
  v_key  text;
  v_data jsonb;
  v_panel jsonb;
  v_flow  jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  -- indicadores reaproveitados (valor e tom), mesmo desligados no dashboard
  foreach v_key in array array['tempo_primeira_resposta', 'taxa_resposta_sla', 'prazo_prometido_cumprido',
                               'conversas_ciclo', 'grupos_silenciosos', 'tempo_resolucao'] loop
    begin
      v_data := public.ind_cached(v_key, f, (select params from public.my_indicators where key = v_key));
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object(
        'value', v_data->'value', 'tone', v_data->'tone', 'hint', v_data->'hint', 'secondary', v_data->'secondary',
        'trend', v_data->'trend'->'data'));
    exception when others then
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object('value', null));
    end;
  end loop;

  -- fluxo de mensagens (por hora num dia, por dia em vários): recebidas x respostas
  begin
    -- a comparação do dashboard ("só números") não mostra o fluxo
    if current_setting('mg.kpi_only', true) is distinct from 'on' then
      v_flow := public.ind_cached('dia_hora_a_hora', f, (select params from public.my_indicators where key = 'dia_hora_a_hora'));
    end if;
  exception when others then
    v_flow := null;
  end;

  -- situação dos grupos agora (mesma regra do painel de grupos)
  v_panel := coalesce((
    select jsonb_agg(g) from jsonb_array_elements(public.groups_panel()) g
    where p_group_id is null or (g->>'id')::uuid = p_group_id
  ), '[]'::jsonb);

  return jsonb_build_object(
    -- atendimento no período
    'client_messages', (select count(*) from public.ind_scope(f) m where not m.from_team),
    'team_replies', (select count(*) from public.ind_scope(f) m
                      where m.from_team and (p_member_id is null or m.team_member_id = p_member_id)),
    'first_response', v_kpi->'tempo_primeira_resposta',
    'sla_rate', v_kpi->'taxa_resposta_sla',
    'sla_target', (select (params->>'target_percent')::numeric from public.my_indicators where key = 'taxa_resposta_sla'),
    -- situação agora
    'groups_waiting', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' in ('waiting', 'late')),
    'groups_late', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' = 'late'),
    'pending_messages', (select coalesce(sum((g->>'pending_count')::int), 0) from jsonb_array_elements(v_panel) g),
    'alerts_open', (select count(*) from public.alerts a
                     where a.status <> 'resolved' and (p_group_id is null or a.group_id = p_group_id)),
    'alerts_critical', (select count(*) from public.alerts a
                         where a.status <> 'resolved' and a.severity = 'critical'
                           and (p_group_id is null or a.group_id = p_group_id)),
    'whatsapp', (select case when bool_or(status = 'connected') then 'connected'
                             when count(*) = 0 then 'none' else 'disconnected' end
                 from public.whatsapp_instances),
    -- demandas
    'demands_open', (select count(*) from public.demands d
                      where d.status in ('aberta', 'em_andamento')
                        and (p_group_id is null or d.group_id = p_group_id)
                        and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_overdue', (select count(*) from public.demands d
                         where d.status in ('aberta', 'em_andamento') and d.promised_at < now()
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_created', (select count(*) from public.demands d
                         where d.opened_at >= p_from and d.opened_at < p_to
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_delivered', (select count(*) from public.demands d
                           where d.delivered_at >= p_from and d.delivered_at < p_to
                             and (p_group_id is null or d.group_id = p_group_id)
                             and (p_member_id is null or d.assignee_id = p_member_id)),
    'promise_kept', v_kpi->'prazo_prometido_cumprido',
    'resolution_time', v_kpi->'tempo_resolucao',
    -- conversas e grupos
    'conversations', v_kpi->'conversas_ciclo',
    -- fechadas = encerradas + compromisso de retorno (mesma regra do indicador)
    'conversations_closed_rate', (
      select case when coalesce((v_kpi->'conversas_ciclo'->>'value')::numeric, 0) = 0 then null
                  else round(100.0 * coalesce(sum((x->>'value')::numeric), 0)
                             / (v_kpi->'conversas_ciclo'->>'value')::numeric, 1) end
      from jsonb_array_elements(coalesce(v_kpi->'conversas_ciclo'->'secondary', '[]'::jsonb)) x
      where x->>'label' in ('Encerradas', 'Compromisso de retorno')),
    'groups_active', (select count(distinct m.group_id) from public.ind_scope(f) m),
    'groups_monitored', (select count(*) from public.groups g
                          where g.monitored and g.removed_at is null and (p_group_id is null or g.id = p_group_id)),
    'groups_silent', v_kpi->'grupos_silenciosos',
    'flow', coalesce(v_flow->'data', '[]'::jsonb),
    'flow_hourly', coalesce(v_flow->>'visual' = 'bars', false)
  );
end;
$$;

-- indicadores + resumo da gestão de um período numa chamada só (os dois aproveitam os mesmos cálculos).
-- p_kpi_only: período de comparação, que só usa os números (sem gráficos, tabelas e listas)
create or replace function public.dashboard_bundle(p_from timestamptz, p_to timestamptz, p_group_id uuid default null,
                                                   p_member_id uuid default null, p_kpi_only boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform set_config('mg.kpi_only', case when p_kpi_only then 'on' else 'off' end, true);
  return jsonb_build_object(
    'indicators', public.indicator_values(p_from, p_to, p_group_id, p_member_id),
    'summary', public.management_summary(p_from, p_to, p_group_id, p_member_id));
end;
$$;
revoke all on function public.dashboard_bundle(timestamptz, timestamptz, uuid, uuid, boolean) from public, anon;
grant execute on function public.dashboard_bundle(timestamptz, timestamptz, uuid, uuid, boolean) to authenticated;
