-- =====================================================================
-- Início e fechamento das conversas nos grupos
--
-- Uma conversa começa com a primeira mensagem que pede atenção quando não
-- há conversa aberta no grupo (do cliente; da equipe também, se o
-- parâmetro permitir). Ela fecha com:
--  * mensagem de ENCERRAMENTO: o cliente agradece/confirma ("obrigado",
--    "deu certo") depois de a equipe participar, ou a equipe encerra
--    ("qualquer dúvida estamos à disposição", "resolvido");
--  * COMPROMISSO DE RETORNO da equipe ("vou verificar e te retorno",
--    "te aviso assim que"). Para esses, a análise mostra se a equipe
--    voltou a falar no grupo depois (retorno cumprido).
-- Se o grupo fica parado mais que o limite (padrão 24 h) sem fechamento,
-- a conversa conta como "sem fechamento".
-- =====================================================================

-- Palavras de compromisso e de encerramento da equipe (parâmetros do indicador)
create or replace function public.team_close_kind(p_body text, p jsonb)
returns text
language sql stable set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_body, '')), '') is null then null
    when public.match_keyword(p_body, p->'commitment_keywords') is not null then 'compromisso'
    when public.match_keyword(p_body, p->'team_closing_keywords') is not null then 'encerramento'
  end
$$;

create or replace function public.ind_conversations(f jsonb, p jsonb)
returns table (
  group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text,
  first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text,
  last_at timestamptz, msgs int, returned_at timestamptz
)
language plpgsql stable set search_path = public
as $$
declare
  -- palavras de pergunta/pedido/urgência/encerramento do cliente vêm da análise "Precisa de resposta?"
  v_sig_p jsonb := coalesce((select i.params from public.indicators i where i.key = 'analise_sem_resposta'), '{}'::jsonb)
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
                    case when s.from_team then 'Equipe' else 'Cliente' end) as who
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

    if m.from_team then
      v_kind := public.team_close_kind(m.body, p);
      v_sig := null;
    else
      v_sig := public.reply_signal(m.body, m.message_type, v_sig_p);
      v_kind := null;
    end if;

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

-- ---------------------------------------------------------------------
-- Cartão: conversas iniciadas e como fecharam
-- ---------------------------------------------------------------------
create or replace function public.ind_conversas_ciclo(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (select * from public.ind_conversations(f, p)),
  agg as (
    select count(*)::int as n,
           count(*) filter (where status = 'encerrada')::int as closed,
           count(*) filter (where status = 'compromisso')::int as promised,
           count(*) filter (where status = 'compromisso' and returned_at is null)::int as promised_pending,
           count(*) filter (where status = 'aberta')::int as open,
           count(*) filter (where status = 'sem_fechamento')::int as unclosed,
           round(avg(extract(epoch from closed_at - started_at)) filter (where closed_at is not null)) as avg_close
    from c
  ),
  v as (select agg.*, case when n > 0 then round(100.0 * (closed + promised) / n, 1) end as pct from agg),
  trend as (
    select to_char((started_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
           round(100.0 * count(*) filter (where status in ('encerrada', 'compromisso')) / count(*), 1) as value
    from c group by 1 order by 1
  ),
  -- o que ainda pede ação: em aberto, retorno prometido e ainda não feito, e as que ficaram sem fechamento
  pending as (
    select *, case when status = 'aberta' then 0 when status = 'compromisso' then 1 else 2 end as ord
    from c where status in ('aberta', 'sem_fechamento') or (status = 'compromisso' and returned_at is null)
    order by ord, started_at
    limit 50
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', n,
    'unit', case when n = 1 then 'conversa iniciada' else 'conversas iniciadas' end,
    'tone', case when n = 0 or pct is null then null
                 when pct >= coalesce((p->>'target_percent')::numeric, 80) then 'good'
                 when pct >= coalesce((p->>'target_percent')::numeric, 80) - 15 then 'warning'
                 else 'critical' end,
    'hint', case when n = 0 then 'Nenhuma conversa iniciada no período'
                 else coalesce(pct::text, '0') || '% fechadas (encerramento ou compromisso de retorno)'
                      || case when avg_close is not null then ' · tempo médio até fechar: '
                              || case when avg_close >= 3600 then floor(avg_close / 3600) || 'h' || lpad((floor(avg_close / 60)::int % 60)::text, 2, '0')
                                      else greatest(1, round(avg_close / 60)) || ' min' end
                              else '' end end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Encerradas', 'value', closed, 'format', 'number'),
      jsonb_build_object('label', 'Compromisso de retorno', 'value', promised, 'format', 'number'),
      jsonb_build_object('label', 'Retorno pendente', 'value', promised_pending, 'format', 'number'),
      jsonb_build_object('label', 'Em aberto', 'value', open, 'format', 'number'),
      jsonb_build_object('label', 'Sem fechamento', 'value', unclosed, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id,
        'sublabel', case status when 'sem_fechamento' then 'Sem fechamento · ' || starter || ': “'
                                    || left(coalesce(start_body, '[mídia]'), 60)
                                when 'compromisso' then 'Retorno pendente · ' || closer || ': “' || left(coalesce(close_body, ''), 60)
                                else 'Em aberto · ' || starter || ': “' || left(coalesce(start_body, '[mídia]'), 60) end
                    || case when length(coalesce(case when status = 'compromisso' then close_body else start_body end, '')) > 60
                            then '…' else '' end || '”',
        -- tempo: desde o início (aberta/sem fechamento) ou desde o compromisso
        'detail', extract(epoch from now() - coalesce(case when status = 'compromisso' then closed_at end, started_at))::int,
        'detail_format', 'duration',
        'tone', case when status = 'aberta' then 'warning' else 'critical' end
      ) order by ord, started_at)
      from pending
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 4), 1),
    'list_more', greatest(open + unclosed + promised_pending - (select count(*) from pending), 0),
    'trend', jsonb_build_object('format', 'percent', 'label', '% fechadas',
      'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'value', value)) from trend), '[]'::jsonb))
  )
  from v
$$;

create or replace function public.ind_conversas_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'group_by', jsonb_build_object('key', 'group_id', 'label', 'group_name', 'noun', jsonb_build_array('conversa', 'conversas')),
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'started_at', 'label', 'Início', 'format', 'datetime'),
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'starter', 'label', 'Iniciada por'),
      jsonb_build_object('key', 'start_body', 'label', 'Primeira mensagem'),
      jsonb_build_object('key', 'status_label', 'label', 'Situação'),
      jsonb_build_object('key', 'closed', 'label', 'Fechada', 'summary', 'share', 'summary_match', 'Sim'),
      jsonb_build_object('key', 'closed_at', 'label', 'Fechamento', 'format', 'datetime'),
      jsonb_build_object('key', 'closer', 'label', 'Fechada por'),
      jsonb_build_object('key', 'close_body', 'label', 'Mensagem de fechamento'),
      jsonb_build_object('key', 'duration', 'label', 'Duração', 'format', 'duration', 'align', 'right', 'summary', 'avg'),
      jsonb_build_object('key', 'msgs', 'label', 'Msgs', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'returned', 'label', 'Retorno do compromisso')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name, 'started_at', started_at,
      'starter', starter || case when started_by = 'equipe' then ' (equipe)' else '' end,
      'start_body', left(coalesce(start_body, '[mídia]'), 200),
      'status_label', case status when 'encerrada' then 'Encerrada' when 'compromisso' then 'Compromisso de retorno'
                                  when 'aberta' then 'Em aberto' else 'Sem fechamento' end,
      'closed', case when closed_at is not null then 'Sim' else 'Não' end,
      'closed_at', closed_at, 'closer', closer, 'close_body', left(close_body, 200),
      'duration', case when closed_at is not null then extract(epoch from closed_at - started_at)::int
                       else extract(epoch from last_at - started_at)::int end,
      'msgs', msgs,
      'returned', case when status <> 'compromisso' then null
                       when returned_at is null then 'Pendente'
                       else 'Retornou em ' || to_char(returned_at at time zone (f->>'tz'), 'DD/MM HH24:MI') end
    ) order by started_at desc), '[]'::jsonb)
  )
  from (select * from public.ind_conversations(f, p) order by started_at desc limit 500) x
$$;

create or replace function public.ind_conversas_ciclo_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_conversas_details(f, p) $$;

-- ---------------------------------------------------------------------
-- Gráfico: conversas iniciadas x fechadas por dia
-- (usa os parâmetros do cartão de ciclo, para as duas análises baterem)
-- ---------------------------------------------------------------------
create or replace function public.ind_conversas_por_dia(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with c as (
    select * from public.ind_conversations(f,
      coalesce((select i.params from public.indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb))
  ),
  days as (
    select to_char(d, 'YYYY-MM-DD') as x
    from generate_series(((f->>'from')::timestamptz at time zone (f->>'tz'))::date,
                         (((f->>'to')::timestamptz - interval '1 second') at time zone (f->>'tz'))::date,
                         interval '1 day') d
  ),
  s as (select to_char((started_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as n from c group by 1),
  e as (select to_char((closed_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x,
               count(*) filter (where status = 'encerrada') as closed,
               count(*) filter (where status = 'compromisso') as promised
        from c where closed_at is not null group by 1),
  u as (select to_char((last_at at time zone (f->>'tz'))::date, 'YYYY-MM-DD') as x, count(*) as n
        from c where status = 'sem_fechamento' group by 1)
  select jsonb_build_object(
    'visual', 'series',
    'format', 'number',
    'series', jsonb_build_array(
      jsonb_build_object('key', 'started', 'label', 'Iniciadas'),
      jsonb_build_object('key', 'closed', 'label', 'Encerradas'),
      jsonb_build_object('key', 'promised', 'label', 'Compromisso de retorno'),
      jsonb_build_object('key', 'unclosed', 'label', 'Sem fechamento')
    ),
    'data', coalesce(jsonb_agg(jsonb_build_object(
      'x', days.x,
      'started', coalesce(s.n, 0), 'closed', coalesce(e.closed, 0),
      'promised', coalesce(e.promised, 0), 'unclosed', coalesce(u.n, 0)
    ) order by days.x), '[]'::jsonb)
  )
  from days
  left join s on s.x = days.x
  left join e on e.x = days.x
  left join u on u.x = days.x
$$;

create or replace function public.ind_conversas_por_dia_details(f jsonb, p jsonb)
returns jsonb language sql stable set search_path = public
as $$ select public.ind_conversas_details(f, coalesce((select i.params from public.indicators i where i.key = 'conversas_ciclo'), '{}'::jsonb)) $$;

-- ---------------------------------------------------------------------
-- Catálogo: novo bloco "Ciclo das conversas"
-- ---------------------------------------------------------------------
insert into public.indicator_blocks (key, name, description, position) values
  ('ciclo_conversas', 'Ciclo das conversas', 'Quando as conversas começam nos grupos e como terminam: encerramento ou compromisso de retorno.', 2)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.indicators where key = 'conversas_ciclo') then
    -- abre espaço logo depois de Capacidade de resposta
    update public.indicator_blocks set position = position + 1 where key <> 'ciclo_conversas' and position >= 2;

    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('conversas_ciclo', 'ciclo_conversas', 'Início e fechamento das conversas',
       'Conta as conversas iniciadas nos grupos e como cada uma terminou: com mensagem de encerramento (o cliente agradece ou confirma, ou a equipe encerra) ou com compromisso de retorno da equipe ("vou verificar e te retorno"). Conversas paradas além do limite sem fechamento contam como "sem fechamento". A lista mostra as que ainda não fecharam.',
       1, 'kpi', 2, false, false,
       jsonb_build_object(
         'idle_hours', 24, 'target_percent', 80, 'list_size', 4, 'team_can_start', true,
         'commitment_keywords', jsonb_build_array('vou verificar', 'vamos verificar', 'vou ver', 'vamos ver', 'vou checar',
           'vamos checar', 'vou analisar', 'vamos analisar', 'te retorno', 'retorno em', 'retorno até', 'já retorno',
           'retornamos', 'retorno assim que', 'te aviso', 'aviso assim que', 'assim que tiver', 'assim que possível',
           'vou providenciar', 'vamos providenciar', 'vou encaminhar', 'vamos encaminhar', 'vou resolver', 'vamos resolver',
           'até amanhã te', 'ainda hoje'),
         'team_closing_keywords', jsonb_build_array('qualquer dúvida', 'qualquer coisa', 'estamos à disposição',
           'fico à disposição', 'à disposição', 'disponha', 'resolvido', 'finalizado', 'concluído', 'por nada',
           'tenha um bom dia', 'tenha uma boa tarde', 'tenha uma boa noite', 'bom fim de semana', 'ótimo dia')
       ),
       '[{"key":"idle_hours","label":"Conversa parada vira \"sem fechamento\" depois de","type":"int","unit":"horas","min":1,"max":168},
         {"key":"target_percent","label":"Meta de conversas fechadas","type":"int","unit":"%","min":1,"max":100},
         {"key":"list_size","label":"Conversas listadas no cartão","type":"int","min":1,"max":15},
         {"key":"team_can_start","label":"Contar conversas iniciadas pela equipe","type":"bool"},
         {"key":"commitment_keywords","label":"Palavras de compromisso de retorno (equipe)","type":"tags","help":"Mensagem da equipe com uma destas palavras fecha a conversa como compromisso de retorno."},
         {"key":"team_closing_keywords","label":"Palavras de encerramento da equipe","type":"tags","help":"Mensagem da equipe com uma destas palavras encerra a conversa."},
         {"key":"client_closing_keywords","label":"Palavras de encerramento do cliente","type":"tags","help":"Agradecimento ou confirmação do cliente encerra a conversa depois que a equipe participou. Vazio = usar as do indicador \"Precisa de resposta?\"."}]'::jsonb);
    update public.indicators set params = default_params where key = 'conversas_ciclo';

    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('conversas_por_dia', 'ciclo_conversas', 'Conversas por dia',
       'Conversas iniciadas, encerradas, fechadas com compromisso de retorno e sem fechamento, dia a dia. Usa as mesmas regras do cartão "Início e fechamento das conversas".',
       2, 'series', 2, false, false, '{}'::jsonb, '[]'::jsonb);
    update public.indicators set params = default_params where key = 'conversas_por_dia';
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
revoke all on function public.team_close_kind(text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
