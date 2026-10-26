-- =====================================================================
-- Segurança: nada no banco fica acessível sem login.
--
-- O Postgres libera, por padrão, a execução de toda função nova para
-- todos (PUBLIC), inclusive para quem chama a API só com a chave pública
-- (anon, que vai no navegador). As funções sensíveis conferem o usuário,
-- mas duas devolviam dados de qualquer empresa (company_indicator_params e
-- recurrence_alert_candidates) e o executor de scripts ficava exposto.
-- Agora:
--  * quem não está logado (anon) não executa nenhuma função nem lê tabela;
--  * as funções que o painel usa continuam liberadas para os logados;
--  * as do worker e o executor de scripts ficam só com a chave de serviço;
--  * o atualizar_banco.sql reaplica esta trava no fim de cada execução,
--    para valer também nas funções criadas depois.
-- =====================================================================

create or replace function public.lock_down_public_access()
returns void
language plpgsql
set search_path = public
as $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as for_users
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
  loop
    -- o que os usuários logados já executavam continua valendo para eles (e para o worker)
    if f.for_users then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;

  -- só o worker (chave de serviço) e o SQL Editor
  revoke execute on function public.company_indicator_params(uuid, text) from authenticated;
  revoke execute on function public.recurrence_alert_candidates(int, int, uuid) from authenticated;
  revoke execute on function public._apply_migration(text, text) from authenticated;
  revoke execute on function public.lock_down_public_access() from authenticated;

  -- quem não está logado não lê nem grava tabela nenhuma (as regras por linha já barravam; agora
  -- nem chega a elas)
  revoke all on all tables in schema public from anon;
  revoke all on all sequences in schema public from anon;
end;
$$;

select public.lock_down_public_access();
