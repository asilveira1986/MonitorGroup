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
} > atualizar_banco.sql
echo "gerado: supabase/atualizar_banco.sql"
