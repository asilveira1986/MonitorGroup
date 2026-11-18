-- =====================================================================
-- Verifica se este banco do Supabase é o do sistema (só consulta, não altera nada).
-- Rode no SQL Editor do projeto em que você pretende aplicar a atualização e me mande o resultado
-- (uma linha só). Sem a instalação inicial (0001_schema.sql) o resultado mostra "NÃO" e os scripts
-- de atualização param com uma mensagem explicando.
-- =====================================================================
select
  current_database()                                                                  as banco,
  to_regclass('public.whatsapp_instances') is not null                                  as tem_whatsapp_instances,
  to_regclass('public.groups') is not null                                              as tem_groups,
  to_regclass('public.schema_migrations') is not null                                   as tem_controle_de_scripts,
  (select count(*) from information_schema.tables where table_schema = 'public')        as tabelas_em_public,
  case when to_regclass('public.schema_migrations') is not null
       then (select count(*) from public.schema_migrations) end                         as scripts_aplicados,
  case when to_regclass('public.schema_migrations') is not null
       then (select max(version) from public.schema_migrations) end                     as ultimo_script,
  case when to_regclass('public.groups') is not null
       then (select count(*) from public.groups) end                                    as grupos,
  case when to_regclass('public.whatsapp_instances') is not null
       then (select count(*) from public.whatsapp_instances) end                        as numeros_whatsapp,
  case when to_regclass('public.whatsapp_instances') is not null
        and to_regclass('public.groups') is not null then 'SIM: pode aplicar a atualização'
       else 'NÃO: falta a instalação inicial (0001_schema.sql) ou este é outro projeto' end as pode_atualizar;
