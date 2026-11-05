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
  /** endereço do painel nos avisos da automação de atendimento (0144); sem ele, usa APP_URL */
  panelUrl: (process.env.PANEL_URL ?? process.env.APP_URL ?? '').replace(/\/$/, ''),
  /** intervalo mínimo entre as mensagens enviadas pela automação (reduz o risco de bloqueio do número) */
  sendMinIntervalMs: Number(process.env.SEND_MIN_INTERVAL_MS ?? 1500),
  /** fuso do horário de atendimento quando a empresa não tem um configurado */
  tzAtendimento: process.env.TZ_ATENDIMENTO ?? 'America/Sao_Paulo',
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
