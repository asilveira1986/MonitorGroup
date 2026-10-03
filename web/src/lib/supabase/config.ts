/**
 * Corrige os enganos mais comuns ao copiar a URL do Supabase:
 * link do painel (supabase.com/dashboard/project/<id>), "/rest/v1" no final,
 * falta do "https://", aspas ou espaços.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | null {
  let value = (raw ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!value) return null;

  const dashboard = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashboard) return `https://${dashboard[1].toLowerCase()}.supabase.co`;

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) {
      return `https://${url.hostname}`;
    }
    // instalação própria / local: mantém o host e a porta, descarta o caminho
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Variáveis públicas do Supabase. Retorna null se estiverem faltando ou inválidas. */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!url || !key) return null;
  return { url, key };
}

/** Diagnóstico das variáveis de ambiente, para mostrar na tela de login. */
export function configProblem(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return 'As variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não estão configuradas na Vercel. Cadastre-as em Settings › Environment Variables e faça um novo deploy (Deployments › Redeploy).';
  }
  if (!normalizeSupabaseUrl(url)) {
    return `NEXT_PUBLIC_SUPABASE_URL está inválida ("${url.slice(0, 60)}"). Use a "Project URL" do Supabase, no formato https://xxxxxxxx.supabase.co.`;
  }
  if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) {
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY está com a chave secreta (service_role/secret). Use a chave pública: "anon public" ou "Publishable key".';
  }
  return null;
}

function isServiceRoleJwt(key: string) {
  try {
    const part = (key.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
