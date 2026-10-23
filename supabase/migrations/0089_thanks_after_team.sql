-- =====================================================================
-- Agradecimento do cliente logo depois da equipe não deixa pendência.
--
-- O worker passa a reconhecer, logo depois de uma mensagem da equipe, o
-- agradecimento/confirmação mesmo com nomes e palavras soltas ("Combinado
-- Alex! Obrigada!", "Melhoras.") e não abre pendência; volta a abrir se
-- vier pergunta, pedido, problema ou "não". Aqui a mesma regra (igual à de
-- worker/src/acknowledgement.ts, isThanksAfterTeam) vale para as mensagens
-- já gravadas, e os grupos são recalculados (pendências só diminuem).
-- =====================================================================

create or replace function public.is_thanks_after_team(p_body text)
returns boolean
language sql immutable
as $$
  with w as (
    select array_remove(regexp_split_to_array(
             regexp_replace(translate(lower(coalesce(p_body, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z]+', ' ', 'g'),
             ' '), '') as a
  )
  select coalesce(p_body, '') !~ '\?'
     and cardinality(a) between 1 and 15
     and not (a && array['preciso','precisamos','precisa','poderia','poderiam','pode','podem','podes','consegue','conseguem',
       'conseguiria','quando','como','qual','quais','onde','porque','porq','pq','favor','solicito','solicitar','gostaria','queria',
       'quero','mas','porem','entretanto','contudo','problema','erro','urgente','ainda','falta','faltou','faltando','nao','nada',
       'envia','enviar','enviem','manda','mandar','mande','verificar','verifica','verificam','ajudar','duvida','duvidas','pergunta',
       'aguardando','retorno','prazo','cade','novidade','novidades','outra','outro'])
     and exists (select 1 from unnest(a) x
                  where x ~ '^(obrigad[a-z]*|brigad[a-z]*|obg|agradec[a-z]*|grat[oa]s?|valeu|vlw|combinado|perfeit[oa]|otim[oa]|show|beleza|blz|ok|okay|okk|certo|entendi|entendido|maravilha|excelente|melhoras|recebi|recebid[oa]|top|joia|fechado|tranquilo|tmj|amem|amen)$')
  from w
$$;

-- mensagens já gravadas: agradecimento logo depois da equipe deixa de abrir pendência
-- (algumas voltas: "ok" e depois "obrigada" seguidos)
do $$
declare
  v_round int;
  v_n int;
  v_c uuid;
  v_r jsonb;
begin
  for v_round in 1..3 loop
    with counting as (
      select m.id, m.group_id, m.sent_at, m.from_team, m.opens_pending, m.message_type, m.body,
             lag(m.from_team) over (partition by m.group_id order by m.sent_at, m.created_at) as prev_team
        from public.messages m
        join public.groups g on g.id = m.group_id
        join public.app_settings s on s.company_id = g.company_id and s.ignore_acknowledgements
       where not m.ignored_as_last and (m.from_team or m.opens_pending)
    )
    update public.messages m set opens_pending = false
      from counting c
     where m.id = c.id and not c.from_team and c.opens_pending and c.prev_team
       and c.message_type = 'text' and public.is_thanks_after_team(c.body);
    get diagnostics v_n = row_count;
    raise notice 'volta %: % agradecimento(s) deixaram de abrir pendência', v_round, v_n;
    exit when v_n = 0;
  end loop;

  for v_c in select id from public.companies loop
    v_r := public.recalc_company_groups(v_c);
  end loop;
end $$;
