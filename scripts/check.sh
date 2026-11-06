#!/bin/sh
# Roda tudo o que o CI roda (veja .github/workflows/ci.yml): tipos, testes, lint e build do worker e do painel.
# Uso: sh scripts/check.sh            (instala as dependências só se faltarem)
set -e
cd "$(dirname "$0")/.."

echo "== worker: tipos, testes e build =="
(
  cd worker
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run typecheck
  npm test
  npm run build
)

echo "== painel: lint, testes e build =="
(
  cd web
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run lint
  npm test
  NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://example.supabase.co}" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-ci-placeholder}" \
    npm run build
)

echo "== tudo certo =="
