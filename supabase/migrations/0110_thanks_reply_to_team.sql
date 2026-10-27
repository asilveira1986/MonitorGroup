-- =====================================================================
-- Agradecimento respondendo a uma mensagem da equipe não deixa pendência.
--
-- Ex.: a atendente manda um arquivo e o cliente responde (citando) com
-- "Obrigado @Cíntia". Mesmo que outra mensagem do cliente tenha vindo no
-- meio, a resposta à mensagem da equipe que só agradece/confirma encerra o
-- assunto (a mesma regra de "logo depois da equipe": volta a pedir
-- resposta se vier pergunta, pedido, problema ou "não"). O worker já faz
-- assim nas novas; aqui valem também as mensagens já gravadas, e os grupos
-- são recalculados (pendências só diminuem).
-- =====================================================================

do $$
declare
  v_n int;
  v_c uuid;
  v_r jsonb;
begin
  update public.messages m set opens_pending = false
    from public.groups g
    join public.app_settings s on s.company_id = g.company_id and s.ignore_acknowledgements
   where g.id = m.group_id
     and m.opens_pending and not m.from_team and m.message_type = 'text'
     and m.quoted_wa_id is not null
     and public.is_thanks_after_team(m.body)
     and exists (select 1 from public.messages q
                  where q.group_id = m.group_id and q.wa_message_id = m.quoted_wa_id and q.from_team);
  get diagnostics v_n = row_count;
  raise notice '% agradecimento(s) respondendo a equipe deixaram de abrir pendência', v_n;
  if v_n > 0 then
    for v_c in select id from public.companies loop
      v_r := public.recalc_company_groups(v_c);
    end loop;
  end if;
end $$;
