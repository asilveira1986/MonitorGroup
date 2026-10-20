-- =====================================================================
-- Limpa "mensagens" técnicas do WhatsApp gravadas por engano.
--
-- Pacotes criptografados/técnicos (respostas a Eventos, edições e
-- comentários criptografados, resumo de enquete, marcador de "aguardando
-- esta mensagem", menção do grupo em status) não têm texto e apareciam na
-- conversa como "secretEncrypted", contando como mensagem do cliente (o
-- grupo podia ficar "aguardando resposta" à toa). O worker passa a ignorá-los;
-- aqui os já gravados são apagados e os grupos afetados, recalculados.
-- =====================================================================

do $$
declare
  v_company uuid;
  v_n int;
begin
  create temp table _tech_groups on commit drop as
    select distinct m.group_id
    from public.messages m
    where m.message_type in ('secretEncrypted', 'encEventResponse', 'encComment',
                             'pollResultSnapshot', 'placeholder', 'statusMention');

  delete from public.messages
   where message_type in ('secretEncrypted', 'encEventResponse', 'encComment',
                          'pollResultSnapshot', 'placeholder', 'statusMention');
  get diagnostics v_n = row_count;
  raise notice 'Mensagens técnicas apagadas: %', v_n;

  -- recalcula a situação das empresas com grupos afetados (pendência só diminui)
  for v_company in
    select distinct g.company_id from public.groups g join _tech_groups t on t.group_id = g.id
  loop
    perform public.recalc_company_groups(v_company);
  end loop;
end $$;
