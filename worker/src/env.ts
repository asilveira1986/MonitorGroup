function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM ?? 'Monitor WhatsApp <onboarding@resend.dev>',
  appUrl: (process.env.APP_URL ?? '').replace(/\/$/, ''),
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
