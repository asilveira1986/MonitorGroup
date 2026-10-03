function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

/** Aceita a URL do painel, com /rest/v1, sem https:// ou entre aspas. */
export function normalizeSupabaseUrl(raw: string): string {
  let value = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  const dashboard = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashboard) return `https://${dashboard[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export const env = {
  supabaseUrl: normalizeSupabaseUrl(required('SUPABASE_URL')),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY').trim().replace(/^['"]|['"]$/g, ''),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM ?? 'Monitor WhatsApp <onboarding@resend.dev>',
  appUrl: (process.env.APP_URL ?? '').replace(/\/$/, ''),
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
