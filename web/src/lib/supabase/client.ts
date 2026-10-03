import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig } from './config';

export function createClient() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error('Supabase não configurado: confira NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return createBrowserClient(config.url, config.key);
}
