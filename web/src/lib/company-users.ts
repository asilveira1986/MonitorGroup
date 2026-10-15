import { createAdminClient } from '@/lib/supabase/server';

/**
 * Cria o acesso de uma pessoa numa empresa: autoriza o e-mail na empresa (allowed_emails)
 * e cria o usuário já confirmado, com a senha inicial. Um e-mail pertence a uma empresa só.
 * Roda com a chave de serviço (só no servidor), depois que quem chama já conferiu a permissão.
 */
export async function createCompanyUser(input: {
  companyId: string;
  email: string;
  password: string;
  role: 'admin' | 'agent' | 'viewer';
  name?: string;
  createdBy?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: 'Informe o e-mail.' };
  if (input.password.length < 8) return { ok: false, error: 'Defina uma senha inicial com ao menos 8 caracteres.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: 'Configure SUPABASE_SERVICE_ROLE_KEY no servidor para criar usuários.' };
  }
  const admin = createAdminClient();

  // o e-mail já é de outra empresa?
  const [{ data: invite }, { data: profile }] = await Promise.all([
    admin.from('allowed_emails').select('company_id').eq('email', email).maybeSingle(),
    admin.from('profiles').select('company_id').eq('email', email).maybeSingle(),
  ]);
  const owner = profile?.company_id ?? invite?.company_id;
  if (owner && owner !== input.companyId) {
    return { ok: false, error: 'Este e-mail já tem acesso em outra empresa. Use outro e-mail.' };
  }

  const { error } = await admin
    .from('allowed_emails')
    .upsert({ email, role: input.role, company_id: input.companyId, created_by: input.createdBy ?? null });
  if (error) return { ok: false, error: serviceKeyHint(error.message) };

  if (!profile) {
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: input.name ? { full_name: input.name } : undefined,
    });
    if (createError) {
      return {
        ok: false,
        error: /already been registered|already exists/i.test(createError.message)
          ? 'Já existe um usuário com este e-mail.'
          : serviceKeyHint(createError.message),
      };
    }
  }
  return { ok: true };
}

/** Erros de configuração da chave de serviço, em linguagem de quem vai corrigir na Vercel. */
function serviceKeyHint(message: string) {
  if (/invalid api key|jwt|unauthorized|not allowed|invalid path/i.test(message)) {
    return `Configuração do servidor: confira na Vercel a SUPABASE_SERVICE_ROLE_KEY (chave "service_role"/"secret" do Supabase) e a NEXT_PUBLIC_SUPABASE_URL (https://xxxx.supabase.co) e faça Redeploy. Detalhe: ${message}`;
  }
  return message;
}
