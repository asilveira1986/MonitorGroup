-- =====================================================================
-- Dashboard e Painel de grupos mais rápidos (volume alto de mensagens).
--
-- Medido com ~50 mil mensagens de grupo (30 dias no dashboard):
--  * reply_signal (classifica cada mensagem do cliente: pergunta, pedido,
--    agradecimento...) levava ~0,4 ms por mensagem: 3,5 s só nas
--    conversas. Agora em plpgsql, normalizando o texto uma vez e só
--    testando as palavras (sem procurar qual delas bateu): ~14x mais
--    rápido, mesmo resultado.
--  * team_close_kind: o mesmo.
--  * ind_responses (respostas da equipe com o tempo em horário comercial)
--    era recalculada por cada indicador que a usa (e, dentro da consulta,
--    mais de uma vez): agora é calculada uma vez por carregamento e
--    reaproveitada, como as conversas (0115).
-- =====================================================================

create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text;
  pat text;
begin
  if p_type in ('sticker', 'reaction') then
    return 'closing';
  end if;
  if p_type = 'audio' then
    return 'audio';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return case when p_type in ('image', 'video', 'document') then 'media' else 'plain' end;
  end if;
  n := public.norm_text(btrim(p_body));
  pat := public.kw_pattern(p->'urgent_keywords');
  if pat is not null and n ~ pat then
    return 'urgent';
  end if;
  if p_body ~ '[?¿]'
     or n ~ ('^(quem|qual|quais|quando|onde|como|quanto|quantos|quantas|por que|porque|pq|'
             || 'sera que|alguem|voces|vcs|tem como|teria como|consegue|conseguem|poderia|poderiam|pode(?! deixar)|podem|'
             || 'da pra|da para|e possivel|seria possivel|existe|ha como|tem previsao)([^[:alnum:]]|$)') then
    return 'question';
  end if;
  pat := public.kw_pattern(p->'request_keywords');
  if pat is not null and n ~ pat then
    return 'request';
  end if;
  if n ~ ('^(bom dia|boa tarde|boa noite|oi+|ola|opa|e ai|salve|oie)'
          || '([ ,!.]+(pessoal|a todos|todos|gente|galera|tudo bem|tudo bom|como vai))*[ !.,]*$') then
    return 'greeting';
  end if;
  pat := public.kw_pattern(p->'closing_keywords');
  if pat is not null and n ~ pat and length(btrim(p_body)) <= 80 then
    return 'closing';
  end if;
  -- só emojis/pontuação
  if p_body !~ '[[:alnum:]]' then
    return 'closing';
  end if;
  -- risadas
  if n ~ '^((k|ha|he|hi|rs|ks)+[ !.]*)+$' then
    return 'social';
  end if;
  return 'plain';
end;
$$;

create or replace function public.team_close_kind(p_body text, p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text;
  pat text;
begin
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return null;
  end if;
  n := public.norm_text(p_body);
  pat := public.kw_pattern(p->'commitment_keywords');
  if pat is not null and n ~ pat then
    return 'compromisso';
  end if;
  pat := public.kw_pattern(p->'team_closing_keywords');
  if pat is not null and n ~ pat then
    return 'encerramento';
  end if;
  return null;
end;
$$;

-- ------------------------------------------------ respostas da equipe: uma vez por carregamento
-- o cálculo de antes, com outro nome
create or replace function public.ind_responses_calc(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
  asked_at timestamptz, asked_in_business boolean
)
language sql stable set search_path = public
as $$
  select r.id, r.group_id, r.group_name,
         coalesce(tm.name, r.sender_name, case when r.from_me then 'Número conectado' end, 'Equipe'),
         r.team_member_id, r.sent_at, r.response_time_seconds,
         public.business_seconds(r.sent_at - make_interval(secs => r.response_time_seconds), r.sent_at, f),
         r.sla_seconds,
         coalesce(q.sender_name, q.sender_phone, 'Cliente'), q.body,
         r.sent_at - make_interval(secs => r.response_time_seconds),
         public.is_business_time(r.sent_at - make_interval(secs => r.response_time_seconds), f)
  from public.ind_scope(f) r
  left join public.team_members tm on tm.id = r.team_member_id
  left join public.messages q on q.id = r.answered_message_id
  where r.from_team and r.response_time_seconds is not null
    and ((f->>'member_id') is null or r.team_member_id = (f->>'member_id')::uuid)
$$;

create or replace function public.ind_responses(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
  asked_at timestamptz, asked_in_business boolean
)
language plpgsql stable set search_path = public as $$
declare
  -- guardada só durante o carregamento (transação) de quem pediu
  v_key text := 'mgresp.k' || md5(f::text || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)::text into v from public.ind_responses_calc(f) c;
    perform set_config(v_key, v, true);
  end if;
  return query
    select * from jsonb_to_recordset(v::jsonb) as x(
      id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
      response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
      asked_at timestamptz, asked_in_business boolean);
end;
$$;

-- ------------------------------------------------ "SLA só no horário comercial": lido uma vez por carregamento
-- (nos indicadores ela entra no cálculo de cada resposta; lida a cada linha, eram ~0,5 ms por resposta)
create or replace function public.sla_business_time_only()
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_key text := 'mgsla.u' || replace(coalesce(auth.uid()::text, 'x'), '-', '');
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    v := coalesce((select (params->>'business_time_only')::boolean from public.my_indicators where key = 'taxa_resposta_sla'), true)::text;
    perform set_config(v_key, v, true);
  end if;
  return v::boolean;
end;
$$;

-- ------------------------------------------------ conversas privadas
-- quem enviou cada mensagem (dashboard do privado, 0130) e as exclusões em cascata da conversa
create index if not exists private_outgoing_chat_wa_idx on public.private_outgoing (chat_id, wa_message_id);
create index if not exists private_actions_chat_idx on public.private_actions (chat_id);

-- ------------------------------------------------ demandas: "minhas pessoas da equipe" calculado uma vez por consulta
drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select
  using (group_id in (select unnest(public.visible_group_ids()))
         or (company_id = (select public.current_company_id())
             and assignee_id in (select unnest(public.my_team_member_ids()))));
