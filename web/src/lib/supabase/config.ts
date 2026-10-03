/** Variáveis públicas do Supabase. Retorna null se estiverem faltando. */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

/** Diagnóstico das variáveis de ambiente, para mostrar na tela de login. */
export function configProblem(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return 'As variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não estão configuradas na Vercel. Cadastre-as em Settings › Environment Variables e faça um novo deploy (Deployments › Redeploy).';
  }
  if (!/^https?:\/\//.test(url) || url.includes('/rest/v1') || url.includes('supabase.com/dashboard')) {
    return 'NEXT_PUBLIC_SUPABASE_URL parece errada. Use a "Project URL" do Supabase, no formato https://xxxxxxxx.supabase.co (sem /rest/v1 no final).';
  }
  if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) {
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY está com a chave secreta (service_role/secret). Use a chave pública: "anon public" ou "Publishable key".';
  }
  return null;
}

function isServiceRoleJwt(key: string) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString());
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
