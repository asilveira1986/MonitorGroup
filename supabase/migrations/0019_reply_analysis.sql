-- =====================================================================
-- Análise "Precisa de resposta?"
--
-- Para cada grupo, olha as últimas mensagens dos clientes depois da última
-- mensagem da equipe e decide, por regras, se a conversa precisa de
-- resposta:
--  * Precisa:     pergunta, pedido, problema/urgência ou o cliente
--                 respondeu a uma pergunta da equipe.
--  * Verificar:   áudio, arquivo sem texto, só cumprimento, ou o cliente
--                 encerrou ("ok", "obrigado") depois de ter pedido algo.
--  * Não precisa: agradecimento/encerramento, risadas e emojis, ou
--                 mensagens sem pergunta, pedido ou problema.
-- As listas de palavras ficam nos parâmetros do indicador e podem ser
-- editadas em Configurações › Indicadores.
-- =====================================================================

-- Classifica uma mensagem do cliente:
-- urgent | question | request | closing | greeting | social | audio | media | plain
create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
returns text
language sql stable set search_path = public
as $$
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

-- Uma linha por grupo com mensagens de cliente depois da última da equipe
create or replace function public.ind_reply_analysis(f jsonb, p jsonb)
returns table (
  group_id uuid, group_name text, verdict text, priority text, reason text, quote text, client_name text,
  msgs int, clients int, first_at timestamptz, last_at timestamptz, waiting_seconds int, overdue boolean, signals text
)
language sql stable set search_path = public
as $$
  with g as (
    select g.id, g.name, coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s,
           (select max(t.sent_at) from public.messages t where t.group_id = g.id and t.from_team) as last_team_at
    from public.groups g cross join public.app_settings s
    where g.monitored and g.removed_at is null
      and ((f->>'group_id') is null or g.id = (f->>'group_id')::uuid)
      and g.last_client_message_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
  ),
  -- últimas N mensagens do cliente depois da última mensagem da equipe
  m as (
    select g.id as group_id, g.name as group_name, g.sla_s, g.last_team_at, x.*,
           public.reply_signal(x.body, x.message_type, p) as sig,
           row_number() over (partition by g.id order by x.sent_at desc) as rn
    from g
    cross join lateral (
      select c.id, c.body, c.message_type, c.sent_at,
             coalesce(c.sender_name, c.sender_phone, 'Cliente') as who, coalesce(c.sender_jid, c.sender_phone) as who_key
      from public.messages c
      where c.group_id = g.id and not c.from_team
        and c.sent_at > coalesce(g.last_team_at, '-infinity')
        and c.sent_at >= now() - make_interval(days => coalesce((p->>'lookback_days')::int, 7))
      order by c.sent_at desc
      limit greatest(coalesce((p->>'max_messages')::int, 8), 1)
    ) x
  ),
  -- a última mensagem da equipe terminou com pergunta ao cliente?
  team_q as (
    select g.id as group_id,
           coalesce((select t.body ~ '[?¿]' from public.messages t
                     where t.group_id = g.id and t.from_team order by t.sent_at desc limit 1), false) as asked
    from g
  ),
  agg as (
    select m.group_id, min(m.group_name) as group_name, min(m.sla_s) as sla_s,
           count(*)::int as msgs, count(distinct m.who_key)::int as clients,
           min(m.sent_at) as first_at, max(m.sent_at) as last_at,
           (array_agg(m.sig order by m.sent_at desc))[1] as last_sig,
           (array_agg(m.body order by m.sent_at desc))[1] as last_body,
           (array_agg(m.who order by m.sent_at desc))[1] as last_who,
           bool_or(m.sig = 'urgent') as has_urgent,
           bool_or(m.sig = 'question') as has_question,
           bool_or(m.sig = 'request') as has_request,
           count(*) filter (where m.sig in ('urgent', 'question', 'request'))::int as asks,
           min(m.sent_at) filter (where m.sig in ('urgent', 'question', 'request')) as first_ask_at,
           -- mensagem que motivou a decisão: a mais recente com o sinal mais forte
           (array_agg(m.body order by case m.sig when 'urgent' then 0 when 'question' then 1 when 'request' then 2 else 9 end, m.sent_at desc))[1] as top_body,
           (array_agg(m.who order by case m.sig when 'urgent' then 0 when 'question' then 1 when 'request' then 2 else 9 end, m.sent_at desc))[1] as top_who,
           string_agg(distinct case m.sig when 'urgent' then 'urgência' when 'question' then 'pergunta' when 'request' then 'pedido'
                                   when 'closing' then 'encerramento' when 'greeting' then 'cumprimento' when 'social' then 'conversa'
                                   when 'audio' then 'áudio' when 'media' then 'arquivo' else 'texto' end, ', ') as signals
    from m
    group by m.group_id
  ),
  d as (
    select a.*, tq.asked as team_asked,
      case
        when a.last_sig = 'closing' and a.asks > 0 then 'check'
        when a.last_sig = 'closing' then 'no'
        when a.has_urgent or a.has_question or a.has_request then 'needs'
        when a.last_sig = 'plain' and tq.asked then 'needs'
        when a.last_sig in ('audio', 'media', 'greeting') then 'check'
        else 'no'
      end as verdict
    from agg a join team_q tq on tq.group_id = a.group_id
  ),
  w as (
    select d.*,
           -- espera contada desde o primeiro pedido/pergunta sem resposta (ou a primeira mensagem da sequência)
           case when d.verdict = 'needs' and d.asks > 0 then d.first_ask_at else d.first_at end as since
    from d
  ),
  w2 as (
    select w.*, extract(epoch from now() - w.since)::int as waiting,
           (case when public.sla_business_time_only() then public.business_seconds(w.since, now(), f)
                 else extract(epoch from now() - w.since)::int end) > w.sla_s as late
    from w
  )
  select group_id, group_name, verdict,
         case when verdict <> 'needs' then 'normal'
              when has_urgent or late or asks >= 3 then 'alta' else 'normal' end,
         case
           when verdict = 'needs' and has_urgent then 'Problema ou urgência'
           when verdict = 'needs' and has_question then 'Pergunta sem resposta'
           when verdict = 'needs' and has_request then 'Pedido sem resposta'
           when verdict = 'needs' then 'Respondeu à pergunta da equipe'
           when verdict = 'check' and last_sig = 'closing' then 'Encerrou, mas antes pediu ou perguntou algo'
           when verdict = 'check' and last_sig = 'audio' then 'Áudio: ouça para saber se precisa de resposta'
           when verdict = 'check' and last_sig = 'media' then 'Enviou arquivo sem texto'
           when verdict = 'check' then 'Só cumprimento, pode estar esperando atenção'
           when last_sig = 'closing' then 'Cliente agradeceu ou encerrou'
           when last_sig = 'social' then 'Conversa social (risadas, emojis)'
           else 'Sem pergunta, pedido ou problema'
         end
         || case when verdict = 'needs' and asks >= 2 then ' · insistiu ' || asks || 'x' else '' end,
         left(coalesce(case when verdict = 'needs' and asks > 0 then top_body else last_body end, '[mídia]'), 160),
         case when verdict = 'needs' and asks > 0 then top_who else last_who end,
         msgs, clients, first_at, last_at, waiting, late, signals
  from w2
$$;

create or replace function public.ind_analise_sem_resposta(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with r as (select * from public.ind_reply_analysis(f, p)),
  agg as (
    select count(*) filter (where verdict = 'needs')::int as needs,
           count(*) filter (where verdict = 'needs' and priority = 'alta')::int as high,
           count(*) filter (where verdict = 'check')::int as checks,
           count(*) filter (where verdict = 'no')::int as noes
    from r
  ),
  shown as (
    select * from r
    where verdict = 'needs' or (verdict = 'check' and coalesce((p->>'show_check')::boolean, true))
    order by verdict = 'needs' desc, priority = 'alta' desc, waiting_seconds desc
    limit 50
  )
  select jsonb_build_object(
    'visual', 'kpi',
    'format', 'number',
    'value', needs,
    'unit', case when needs = 1 then 'grupo precisa de resposta' else 'grupos precisam de resposta' end,
    'tone', case when high > 0 then 'critical' when needs > 0 then 'warning' else 'good' end,
    'hint', case when needs + checks + noes = 0 then 'Nenhuma mensagem de cliente sem resposta da equipe'
                 else 'Análise das últimas mensagens de cada grupo sem resposta da equipe · tempo = espera' end,
    'secondary', jsonb_build_array(
      jsonb_build_object('label', 'Prioridade alta', 'value', high, 'format', 'number'),
      jsonb_build_object('label', 'Verificar', 'value', checks, 'format', 'number'),
      jsonb_build_object('label', 'Não precisam', 'value', noes, 'format', 'number')
    ),
    'list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', group_name, 'group_id', group_id,
        'sublabel', reason || ' · “' || left(quote, 70) || case when length(quote) > 70 then '…' else '' end || '”',
        'detail', waiting_seconds, 'detail_format', 'duration',
        'tone', case when verdict = 'check' then null when priority = 'alta' then 'critical' else 'warning' end
      ) order by verdict = 'needs' desc, priority = 'alta' desc, waiting_seconds desc)
      from shown
    ), '[]'::jsonb),
    'list_size', greatest(coalesce((p->>'list_size')::int, 5), 1),
    'list_more', greatest(needs + case when coalesce((p->>'show_check')::boolean, true) then checks else 0 end
                          - (select count(*) from shown), 0)
  )
  from agg
$$;

create or replace function public.ind_analise_sem_resposta_details(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'group_name', 'label', 'Grupo', 'link', 'group_id'),
      jsonb_build_object('key', 'verdict_label', 'label', 'Precisa de resposta?'),
      jsonb_build_object('key', 'priority', 'label', 'Prioridade'),
      jsonb_build_object('key', 'reason', 'label', 'Motivo'),
      jsonb_build_object('key', 'quote', 'label', 'Mensagem analisada'),
      jsonb_build_object('key', 'client_name', 'label', 'Cliente'),
      jsonb_build_object('key', 'last_at', 'label', 'Última msg. do cliente', 'format', 'datetime'),
      jsonb_build_object('key', 'msgs', 'label', 'Msgs sem resposta', 'format', 'number', 'align', 'right'),
      jsonb_build_object('key', 'waiting_seconds', 'label', 'Esperando há', 'format', 'duration', 'align', 'right'),
      jsonb_build_object('key', 'signals', 'label', 'Sinais encontrados')
    ),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_name', group_name,
      'verdict_label', case verdict when 'needs' then 'Sim' when 'check' then 'Verificar' else 'Não' end,
      'priority', case when verdict = 'needs' then initcap(priority) else '—' end,
      'reason', reason, 'quote', quote, 'client_name', client_name, 'last_at', last_at,
      'msgs', msgs, 'waiting_seconds', waiting_seconds, 'signals', signals
    ) order by case verdict when 'needs' then 0 when 'check' then 1 else 2 end, priority = 'alta' desc, waiting_seconds desc), '[]'::jsonb)
  )
  from public.ind_reply_analysis(f, p)
$$;

-- No catálogo, no bloco Capacidade de resposta
do $$
begin
  if not exists (select 1 from public.indicators where key = 'analise_sem_resposta') then
    insert into public.indicators
      (key, block_key, name, description, position, visual, size, supports_alert, default_alert_enabled,
       default_params, param_schema)
    values
      ('analise_sem_resposta', 'capacidade_resposta', 'Precisa de resposta?',
       'Analisa as últimas mensagens de cada grupo que ainda não teve resposta da equipe e indica se a conversa precisa de resposta: perguntas, pedidos, problemas e clientes respondendo a uma pergunta da equipe. Agradecimentos, risadas e emojis não contam.',
       6, 'kpi', 2, false, false,
       jsonb_build_object(
         'lookback_days', 7, 'max_messages', 8, 'list_size', 5, 'show_check', true,
         'urgent_keywords', jsonb_build_array('urgente', 'urgência', 'problema', 'erro', 'não funciona', 'não está funcionando',
           'parou', 'travou', 'fora do ar', 'caiu', 'não chegou', 'não recebi', 'atrasado', 'atraso', 'reclamação', 'absurdo',
           'insatisfeito', 'ainda não', 'até agora', 'nada ainda', 'cadê', 'alguém aí', 'aguardando', 'esperando', 'sem resposta',
           'ninguém responde', 'de novo'),
         'request_keywords', jsonb_build_array('preciso', 'precisamos', 'necessito', 'gostaria', 'queria', 'quero', 'por favor',
           'pfv', 'pf', 'favor', 'solicito', 'solicitar', 'me manda', 'me envia', 'manda', 'envia', 'enviar', 'verificar',
           'verifica', 'ajuda', 'ajudar', 'orçamento', 'boleto', 'nota fiscal', 'segunda via', 'cancelar', 'trocar', 'alterar',
           'agendar', 'retorno', 'aguardo', 'me liga', 'ligar', 'segue', 'comprovante', 'paguei', 'pagamento', 'pix', 'transferi'),
         'closing_keywords', jsonb_build_array('obrigado', 'obrigada', 'obg', 'brigado', 'valeu', 'vlw', 'ok', 'okay', 'blz',
           'beleza', 'perfeito', 'combinado', 'show', 'top', 'ótimo', 'entendi', 'certo', 'tudo certo', 'deu certo', 'funcionou',
           'resolvido', 'resolveu', 'recebi', 'chegou', 'joia', 'pode deixar', 'de nada', 'até mais', 'até amanhã', 'abraço', 'tmj', 'fechado')
       ),
       '[{"key":"lookback_days","label":"Analisar conversas dos últimos","type":"int","unit":"dias","min":1,"max":30},
         {"key":"max_messages","label":"Mensagens analisadas por grupo","type":"int","min":2,"max":20,"help":"As mais recentes do cliente depois da última mensagem da equipe."},
         {"key":"list_size","label":"Grupos listados no cartão","type":"int","min":1,"max":15},
         {"key":"show_check","label":"Listar também os casos para verificar (áudio, arquivo, só cumprimento)","type":"bool"},
         {"key":"urgent_keywords","label":"Palavras de problema ou urgência","type":"tags","help":"Deixam a conversa como precisa de resposta, com prioridade alta."},
         {"key":"request_keywords","label":"Palavras de pedido","type":"tags","help":"Indicam que o cliente pediu algo."},
         {"key":"closing_keywords","label":"Palavras de agradecimento ou encerramento","type":"tags","help":"Se a última mensagem do cliente for uma destas, a conversa não precisa de resposta."}]'::jsonb);
    update public.indicators set params = default_params where key = 'analise_sem_resposta';
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
revoke all on function public.reply_signal(text, text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
