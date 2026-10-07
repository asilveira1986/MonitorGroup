#!/bin/sh
# Gera supabase/atualizar_banco.sql juntando os scripts 0002 em diante, na ordem.
# Uso: sh supabase/build-updates.sh
cd "$(dirname "$0")"
{
  echo "-- ====================================================================="
  echo "-- ATUALIZAÇÃO COMPLETA DO BANCO (gerado por supabase/build-updates.sh)"
  echo "-- Junta os scripts 0002 em diante, na ordem. Pode ser executado mais de"
  echo "-- uma vez: o que já existe é mantido e o que falta é criado."
  echo "-- Pré-requisito: 0001_schema.sql já executado (instalação inicial)."
  echo "-- ====================================================================="
  for f in migrations/0*.sql; do
    case "$f" in migrations/0001_*) continue ;; esac
    echo ""
    echo "-- >>>>>>>>>>>>>>>>>>>> $(basename "$f") <<<<<<<<<<<<<<<<<<<<"
    cat "$f"
  done
  echo ""
  echo "notify pgrst, 'reload schema';"
  cat <<'SQL'

-- ---------------------------------------------------------------------
-- Conferência: o SQL Editor mostra esta tabela no final.
-- Todas as linhas com "OK" = banco atualizado.
-- ---------------------------------------------------------------------
select item as "Item", case when ok then 'OK' else 'FALTANDO' end as "Situação"
from (values
  (1, 'Indicadores e configurações (0008)', to_regclass('public.indicators') is not null),
  (2, 'Horário comercial nos indicadores (0009)', to_regprocedure('public.business_seconds(timestamptz,timestamptz,jsonb)') is not null),
  (3, 'Demandas (0010)', to_regclass('public.demands') is not null),
  (4, 'Blocos 3 e 4 de indicadores (0011)', to_regprocedure('public.ind_grupos_silenciosos(jsonb,jsonb)') is not null),
  (5, 'Responder pelo sistema (0012)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'reply_allowed')),
  (6, 'Um worker por vez (0013)', to_regclass('public.worker_lock') is not null),
  (7, 'Reincidência de falta de resposta (0014)', to_regprocedure('public.ind_reincidencia_sem_resposta(jsonb,jsonb)') is not null),
  (8, 'Alerta de reincidência (0015)', exists (select 1 from public.alert_rules where type = 'recurrence')),
  (9, 'Horários de pico com resumo (0016)', (select description like 'Quando os clientes mais escrevem%' from public.indicators where key = 'horarios_pico')),
  (10, 'Pendentes por grupo e arquivos recebidos (0017)', to_regprocedure('public.ind_arquivos_recebidos(jsonb,jsonb)') is not null),
  (11, 'Tempo de resposta desde a última mensagem do cliente (0018)',
      coalesce(obj_description('public.ingest_message(uuid,text,text,text,text,boolean,boolean,uuid,text,text,timestamptz,boolean)'::regprocedure, 'pg_proc') like '%0018%', false)),
  (12, 'Análise "Precisa de resposta?" (0019)', to_regprocedure('public.ind_analise_sem_resposta(jsonb,jsonb)') is not null),
  (13, 'Arquivos sem visualização (0020)', to_regprocedure('public.mark_media_seen(uuid,uuid)') is not null),
  (14, 'Início e fechamento das conversas (0021)', to_regprocedure('public.ind_conversas_ciclo(jsonb,jsonb)') is not null),
  (15, 'Acompanhamento do dia (0022)', to_regprocedure('public.ind_dia_hora_a_hora(jsonb,jsonb)') is not null),
  (16, 'Painel de grupos (0023)', to_regprocedure('public.groups_panel()') is not null),
  (17, 'Configuração do alerta de nova mensagem (0024)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'msg_alert_auto_close')),
  (18, 'Alertas em tela e SLA excedido (0025)', to_regprocedure('public.sla_breaches()') is not null),
  (19, 'Demandas pelo compromisso da equipe (0026)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'demand_commitment_enabled')),
  (20, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
) as t(ord, item, ok)
order by ord;
SQL
} > atualizar_banco.sql
# só a conferência, para checar o banco sem executar tudo de novo
sed -n '/^-- Conferência/,$p' atualizar_banco.sql | sed '1i -- ---------------------------------------------------------------------' > conferir_banco.sql
echo "gerado: supabase/atualizar_banco.sql e supabase/conferir_banco.sql"
