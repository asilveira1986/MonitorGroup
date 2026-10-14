import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabaseConfig, normalizeSupabaseUrl } from './config';

export async function createClient() {
  const cookieStore = await cookies();
  const config = getSupabaseConfig();
  if (!config) throw new Error('Supabase não configurado: faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // chamado a partir de um Server Component: o proxy renova a sessão
        }
      },
    },
  });
}

/**
 * Cliente com service role - usar SOMENTE no servidor e após checar permissão.
 * Usa a mesma correção da URL do cliente comum (sem "/rest/v1", link do painel, aspas...):
 * com a URL crua, a criação de usuários falhava com "Invalid path specified in request URL".
 */
export function createAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!url || !key) throw new Error('Supabase não configurado: faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
