/**
 * Disparos em massa (0150): filtro do público, texto com variáveis, estimativa e ritmo de envio.
 * Sem dependências, para as ações do servidor, as telas e os testes usarem o mesmo código.
 */

export type BroadcastTarget = 'groups' | 'people';

/** Filtro do público (o mesmo que a função broadcast_audience do banco recebe). */
export type BroadcastFilter = {
  target: BroadcastTarget;
  all?: boolean;
  tag_ids?: string[];
  tag_mode?: 'any' | 'all';
  exclude_tag_ids?: string[];
  sector_id?: string | null;
  group_ids?: string[];
  phones?: string[];
};

/** O filtro tem algum critério? (sem critério o público fica vazio, nunca "todos" por engano) */
export function hasCriteria(f: BroadcastFilter): boolean {
  return Boolean(f.all || f.tag_ids?.length || f.sector_id || f.group_ids?.length || f.phones?.length);
}

export type BroadcastRecipient = { key: string; name: string | null; sub: string | null };

export type BroadcastSettingsValues = {
  minDelayS: number;
  maxDelayS: number;
  batchSize: number;
  batchPauseMin: number;
  dailyLimit: number;
};

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettingsValues = { minDelayS: 8, maxDelayS: 25, batchSize: 40, batchPauseMin: 5, dailyLimit: 200 };

/** Ritmo vindo da linha de app_settings (colunas ausentes = padrão). */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): BroadcastSettingsValues {
  const d = DEFAULT_BROADCAST_SETTINGS;
  const n = (v: unknown, fb: number) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : fb);
  return {
    minDelayS: n(row?.broadcast_min_delay_s, d.minDelayS),
    maxDelayS: n(row?.broadcast_max_delay_s, d.maxDelayS),
    batchSize: n(row?.broadcast_batch_size, d.batchSize),
    batchPauseMin: n(row?.broadcast_batch_pause_min, d.batchPauseMin),
    dailyLimit: n(row?.broadcast_daily_limit, d.dailyLimit),
  };
}

/** Valida o ritmo digitado. O mínimo de 3 s entre mensagens protege o número. */
export function validateBroadcastSettings(v: BroadcastSettingsValues): { ok: true } | { ok: false; error: string } {
  const whole = (x: number) => Number.isInteger(x);
  if (![v.minDelayS, v.maxDelayS, v.batchSize, v.batchPauseMin, v.dailyLimit].every(whole)) return { ok: false, error: 'Use só números inteiros.' };
  if (v.minDelayS < 3) return { ok: false, error: 'O intervalo mínimo entre mensagens é de 3 segundos.' };
  if (v.maxDelayS < v.minDelayS) return { ok: false, error: 'O intervalo máximo não pode ser menor que o mínimo.' };
  if (v.maxDelayS > 1800) return { ok: false, error: 'O intervalo máximo é de 30 minutos (1800 segundos).' };
  if (v.batchSize < 5 || v.batchSize > 500) return { ok: false, error: 'O tamanho do lote fica entre 5 e 500 mensagens.' };
  if (v.batchPauseMin < 1 || v.batchPauseMin > 120) return { ok: false, error: 'A pausa entre lotes fica entre 1 e 120 minutos.' };
  if (v.dailyLimit < 1 || v.dailyLimit > 5000) return { ok: false, error: 'O limite de 24 horas fica entre 1 e 5000 mensagens.' };
  return { ok: true };
}

/** Tempo total estimado (s) para enviar n mensagens por um número, no ritmo configurado (limite de 24 h incluído). */
export function estimateSeconds(n: number, s: BroadcastSettingsValues): number {
  if (n <= 0) return 0;
  const avg = (s.minDelayS + s.maxDelayS) / 2;
  const pauses = Math.floor((n - 1) / s.batchSize);
  const base = (n - 1) * avg + pauses * s.batchPauseMin * 60;
  // passou do limite de 24 h: o resto espera a janela abrir
  const extraDays = Math.max(0, Math.ceil(n / s.dailyLimit) - 1);
  return Math.round(base + extraDays * Math.max(0, 24 * 3600 - (s.dailyLimit * avg)));
}

export function formatEstimate(seconds: number): string {
  if (seconds < 60) return 'menos de 1 minuto';
  const m = Math.round(seconds / 60);
  if (m < 60) return `cerca de ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `cerca de ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.round(h / 24);
  return `cerca de ${d} dia${d > 1 ? 's' : ''}`;
}

/** Mesma regra do worker: {nome}, {primeiro_nome} e {grupo}; sem o dado a variável some e a pontuação gruda. */
export function renderBroadcast(template: string, name: string | null | undefined): string {
  const full = (name ?? '').trim();
  const first = full.split(/\s+/)[0] ?? '';
  return template
    .replace(/\{\s*primeiro_nome\s*\}/gi, first)
    .replace(/\{\s*nome\s*\}/gi, full)
    .replace(/\{\s*grupo\s*\}/gi, full)
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  running: 'Enviando',
  paused: 'Pausado',
  done: 'Concluído',
  cancelled: 'Cancelado',
};

export const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Não enviado',
};

export type StatusCounts = Record<'pending' | 'sending' | 'sent' | 'failed' | 'skipped', number>;

export const emptyCounts = (): StatusCounts => ({ pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 });

/** Agrupa as linhas de broadcast_counts por campanha. */
export function groupCounts(rows: { campaign_id: string; status: string; n: number | string }[]): Map<string, StatusCounts> {
  const out = new Map<string, StatusCounts>();
  for (const r of rows) {
    const c = out.get(r.campaign_id) ?? emptyCounts();
    if (r.status in c) c[r.status as keyof StatusCounts] += Number(r.n);
    out.set(r.campaign_id, c);
  }
  return out;
}

export const totalOf = (c: StatusCounts) => c.pending + c.sending + c.sent + c.failed + c.skipped;
