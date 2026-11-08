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
  /** números importados (CSV ou digitados): entram sempre, mesmo fora do cadastro do sistema */
  extra?: { phone: string; name?: string | null }[];
  /** só quem está sem conversa há pelo menos N dias (grupos: sem mensagem; pessoas: sem conversa privada) */
  inactive_days?: number;
};

/** O filtro tem algum critério? (sem critério o público fica vazio, nunca "todos" por engano) */
export function hasCriteria(f: BroadcastFilter): boolean {
  return Boolean(f.all || f.tag_ids?.length || f.sector_id || f.group_ids?.length || f.phones?.length || f.extra?.length || f.inactive_days);
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
  series: 'Recorrente',
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

// ------------------------------------------------------------------ fase 2

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_VARIANTS = 4;

export type MediaType = 'image' | 'video' | 'audio' | 'document';

export const MEDIA_TYPE_LABEL: Record<MediaType, string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' };

/** Tipo do arquivo no WhatsApp a partir do tipo MIME (o que não é imagem, vídeo ou áudio vai como documento). */
export function mediaTypeFromMime(mime: string): MediaType {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') && m !== 'image/svg+xml') return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

export type BroadcastMedia = { path: string; mime: string; name: string; type: MediaType };

/** Dias e horas em que o disparo pode sair (0 = domingo ... 6 = sábado). */
export type BroadcastWindow = { days: number[]; start: string; end: string };

export const WEEKDAY_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DEFAULT_WINDOW: BroadcastWindow = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function validateWindow(w: BroadcastWindow): { ok: true } | { ok: false; error: string } {
  if (w.days.length === 0) return { ok: false, error: 'Escolha pelo menos um dia da semana.' };
  if (!HHMM.test(w.start) || !HHMM.test(w.end)) return { ok: false, error: 'Informe o horário no formato 08:00.' };
  if (w.start === w.end) return { ok: false, error: 'O horário de início e o de fim não podem ser iguais.' };
  return { ok: true };
}

/** Telefone brasileiro só com dígitos e o 55 (DDD + número); null se não parece um telefone. */
export function normalizeBrPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

export type ParsedContacts = { rows: { phone: string; name: string | null }[]; invalid: number; duplicates: number };

const NAME_HEADERS = ['nome', 'name', 'cliente', 'contato'];
const PHONE_HEADERS = ['telefone', 'celular', 'phone', 'whatsapp', 'fone', 'numero', 'número', 'tel'];

/**
 * Lê um CSV de contatos (separador vírgula, ponto e vírgula ou tab). Com cabeçalho (nome, telefone...) usa as
 * colunas; sem cabeçalho, acha o telefone na linha e usa o outro campo como nome. Números repetidos contam
 * uma vez; linhas sem telefone válido ficam de fora (e são contadas em invalid).
 */
export function parseContactsCsv(text: string): ParsedContacts {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedContacts = { rows: [], invalid: 0, duplicates: 0 };
  if (lines.length === 0) return out;
  const first = lines[0]!;
  const delimiter = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());

  let nameCol = -1;
  let phoneCol = -1;
  let start = 0;
  const head = split(first).map((c) => c.toLowerCase());
  const looksLikeHeader = !head.some((c) => c.replace(/\D/g, '').length >= 8) && head.some((c) => c !== '');
  if (looksLikeHeader) {
    start = 1;
    nameCol = head.findIndex((c) => NAME_HEADERS.includes(c));
    phoneCol = head.findIndex((c) => PHONE_HEADERS.includes(c));
  }

  const seen = new Set<string>();
  for (const line of lines.slice(start)) {
    const cells = split(line);
    let rawPhone: string | undefined = phoneCol >= 0 ? cells[phoneCol] : cells.find((c) => c.replace(/\D/g, '').length >= 8);
    let name: string | null | undefined = nameCol >= 0 ? cells[nameCol] : cells.find((c) => c && c !== rawPhone && c.replace(/\D/g, '').length < 8);
    if (looksLikeHeader && phoneCol < 0) rawPhone = cells.find((c) => c.replace(/\D/g, '').length >= 8);
    if (looksLikeHeader && nameCol < 0) name = cells.find((c) => c && c !== rawPhone && c.replace(/\D/g, '').length < 8);
    const phone = rawPhone ? normalizeBrPhone(rawPhone) : null;
    if (!phone) {
      out.invalid++;
      continue;
    }
    if (seen.has(phone)) {
      out.duplicates++;
      continue;
    }
    seen.add(phone);
    out.rows.push({ phone, name: name?.trim() ? name.trim().slice(0, 120) : null });
  }
  return out;
}

export type SavedAudience = { id: string; name: string; target: BroadcastTarget; filter: BroadcastFilter };

export type OptOut = { id: string; phone: string; name: string | null; source: 'reply' | 'manual'; created_at: string };

// ------------------------------------------------------------------ fase 3

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly';

/** Como o disparo se repete (no fuso da empresa). days: 0 = domingo ... 6 = sábado. */
export type Recurrence = {
  freq: RecurrenceFreq;
  time: string;
  days?: number[];
  day_of_month?: number;
  /** AAAA-MM-DD: último dia em que ainda envia */
  until?: string | null;
};

export const DEFAULT_RECURRENCE: Recurrence = { freq: 'weekly', time: '09:00', days: [1], day_of_month: 1, until: null };

export function validateRecurrence(r: Recurrence): { ok: true } | { ok: false; error: string } {
  if (!['daily', 'weekly', 'monthly'].includes(r.freq)) return { ok: false, error: 'Escolha como o disparo se repete.' };
  if (!HHMM.test(r.time)) return { ok: false, error: 'Informe o horário no formato 09:00.' };
  if (r.freq === 'weekly' && !(r.days?.length)) return { ok: false, error: 'Escolha pelo menos um dia da semana.' };
  if (r.freq === 'monthly' && !(Number.isInteger(r.day_of_month) && r.day_of_month! >= 1 && r.day_of_month! <= 31)) {
    return { ok: false, error: 'Escolha o dia do mês (1 a 31).' };
  }
  if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until)) return { ok: false, error: 'Data final inválida.' };
  return { ok: true };
}

/** Texto da repetição: "Toda segunda e quarta às 09:00". */
export function describeRecurrence(r: Recurrence | null | undefined): string {
  if (!r) return '';
  const full = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  let when: string;
  if (r.freq === 'daily') when = 'Todo dia';
  else if (r.freq === 'weekly') {
    const names = [...(r.days ?? [])].sort().map((d) => full[d]).filter(Boolean);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : (names[0] ?? '');
    when = `Toda ${list}`;
  } else when = `Todo dia ${r.day_of_month} do mês`;
  const until = r.until ? ` (até ${r.until.split('-').reverse().join('/')})` : '';
  return `${when} às ${r.time}${until}`;
}

export type BroadcastReport = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  delivered: number;
  read: number;
  replied: number;
  /** enviados a pessoas (só elas têm recibo por pessoa) */
  people: number;
};

/** Percentual inteiro de a sobre b ("—" quando não há base). */
export function percentOf(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—';
}

// ------------------------------------------------------------------ fase 4: gatilhos

export type TriggerKind = 'tag_applied' | 'birthday';

export const TRIGGER_KIND_LABEL: Record<TriggerKind, string> = {
  tag_applied: 'Etiqueta aplicada',
  birthday: 'Aniversário',
};

export type BroadcastTrigger = {
  id: string;
  name: string;
  kind: TriggerKind;
  target: BroadcastTarget;
  tag_id: string | null;
  send_time: string;
  instance_id: string | null;
  message: string;
  optout_footer: boolean;
  enabled: boolean;
  last_run_at: string | null;
  last_run_note: string | null;
  created_at: string;
};

export type TriggerInput = {
  name: string;
  kind: TriggerKind;
  tagId: string | null;
  sendTime: string;
  target: BroadcastTarget;
  instanceId: string | null;
  message: string;
  optoutFooter: boolean;
  /** etiqueta aplicada: também envia a quem já tem a etiqueta agora */
  includeExisting: boolean;
};

export function validateTrigger(t: TriggerInput): { ok: true } | { ok: false; error: string } {
  if (!t.name.trim()) return { ok: false, error: 'Dê um nome ao gatilho.' };
  if (!t.message.trim()) return { ok: false, error: 'Escreva a mensagem.' };
  if (t.message.length > 4000) return { ok: false, error: 'A mensagem passa de 4000 caracteres.' };
  if (t.kind === 'tag_applied' && !t.tagId) return { ok: false, error: 'Escolha a etiqueta que dispara a mensagem.' };
  if (t.kind === 'birthday' && !HHMM.test(t.sendTime)) return { ok: false, error: 'Informe o horário no formato 09:00.' };
  if ((t.kind === 'birthday' || t.target === 'people') && !t.instanceId) return { ok: false, error: 'Escolha o número do WhatsApp que envia.' };
  return { ok: true };
}

/** Resumo da regra: "Quando alguém receber a etiqueta Novo cliente" / "No aniversário, às 09:00". */
export function describeTrigger(t: Pick<BroadcastTrigger, 'kind' | 'target' | 'send_time'>, tagName?: string | null): string {
  if (t.kind === 'birthday') return `No aniversário do contato, às ${t.send_time}`;
  return `Quando ${t.target === 'groups' ? 'um grupo' : 'alguém'} receber a etiqueta ${tagName ?? '(removida)'}`;
}
