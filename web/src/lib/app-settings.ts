import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * Configurações da empresa (app_settings): UMA leitura por requisição. O layout, os menus e a página dividem o
 * mesmo resultado em vez de consultar a mesma linha 2 a 3 vezes a cada navegação. Devolve `{ data }` como a
 * consulta do Supabase, então quem usava `.select(...).single()` só troca a expressão.
 *
 * Lê a linha inteira de propósito: coluna nova que ainda não existe no banco (script SQL por rodar) não derruba
 * a consulta, só vem ausente. O tipo de `data` é livre, como o do cliente do Supabase sem tipos gerados: cada tela
 * usa só as colunas que conhece.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const appSettings = cache(async (): Promise<{ data: any }> => {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('*').maybeSingle();
  return { data: data ?? null };
});
