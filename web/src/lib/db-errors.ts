/**
 * Traduz erros do banco que indicam um script SQL ainda não executado no Supabase
 * (coluna ou função nova que a API ainda não conhece).
 */
export function friendlyDbError(message: string): string {
  const missing =
    /schema cache/i.test(message) ||
    /column .* does not exist/i.test(message) ||
    /function .* does not exist/i.test(message);
  if (!missing) return message;
  return (
    'O banco de dados ainda não tem os campos desta função. Execute no SQL Editor do Supabase os scripts mais ' +
    'recentes da pasta supabase/migrations (na ordem) e tente de novo. ' +
    `Detalhe: ${message}`
  );
}
