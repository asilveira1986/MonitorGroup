-- =====================================================================
-- OPCIONAL: apaga do log de atividades as linhas de ruído do aviso de
-- presença ("Alterou o usuário ...: last_seen_at = ...").
--
-- Só apaga a linha de usuário cuja ÚNICA mudança é last_seen_at. Qualquer
-- outra linha do log (inclusive de usuário, com outra mudança) fica como está.
-- Rode no SQL Editor do Supabase. O passo 1 só conta; o passo 2 apaga.
-- Antes disso, aplique o script 0155 (atualizar_banco*.sql), senão novas
-- linhas continuam sendo gravadas.
-- =====================================================================

-- 1) quantas linhas seriam apagadas (e o total do log, para comparar)
select
  (select count(*) from public.activity_log
    where entity = 'profiles' and action = 'alterou'
      and (select array_agg(k) from jsonb_object_keys(details->'alterado') k) = array['last_seen_at']) as a_apagar,
  (select count(*) from public.activity_log) as total_no_log;

-- 2) apaga (descomente as 4 linhas abaixo depois de conferir o número do passo 1)
-- delete from public.activity_log
--  where entity = 'profiles' and action = 'alterou'
--    and (select array_agg(k) from jsonb_object_keys(details->'alterado') k) = array['last_seen_at'];
