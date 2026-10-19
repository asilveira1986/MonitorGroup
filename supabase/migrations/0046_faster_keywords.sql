-- =====================================================================
-- Desempenho: busca de palavras-chave (indicadores do dashboard).
--
-- match_keyword era chamada para cada mensagem e, para cada palavra da
-- lista (são ~100 nas análises), normalizava o texto de novo e montava uma
-- expressão regular nova. Agora o texto é normalizado uma vez e todas as
-- palavras são testadas numa única expressão (que o banco guarda pronta
-- entre as chamadas). Só quando alguma palavra aparece é feita a busca uma
-- a uma, para devolver a primeira da lista, como antes: o resultado é o
-- mesmo, só mais rápido.
-- =====================================================================

create or replace function public.match_keyword(p_text text, p_keywords jsonb)
returns text
language plpgsql immutable set search_path = public
as $$
declare
  v_text text;
  v_alt  text;
  k      record;
begin
  if p_text is null or jsonb_typeof(p_keywords) is distinct from 'array' or jsonb_array_length(p_keywords) = 0 then
    return null;
  end if;
  v_text := public.norm_text(p_text);

  -- todas as palavras numa expressão só: na maioria das mensagens nenhuma aparece
  select string_agg(regexp_replace(public.norm_text(btrim(e.value)), '([^[:alnum:] ])', '\\\1', 'g'), '|')
    into v_alt
  from jsonb_array_elements_text(p_keywords) as e(value)
  where btrim(e.value) <> '';
  if v_alt is null or v_text !~ ('(^|[^[:alnum:]])(' || v_alt || ')($|[^[:alnum:]])') then
    return null;
  end if;

  -- alguma apareceu: devolve a primeira da lista (mesma regra de antes)
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
