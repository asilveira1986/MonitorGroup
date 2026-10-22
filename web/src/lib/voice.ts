/**
 * Aviso por voz (Web Speech API, no próprio navegador, sem custo).
 * Cada aviso tem uma frase com itens entre chaves, trocados na hora pelos dados do aviso:
 * "Nova mensagem no grupo {grupo}, de {remetente}." Configurável em Configurações › Avisos (tela e voz).
 */

export type VoiceEvent = 'message' | 'sla' | 'alert';

export type VoiceOptions = {
  templates?: Partial<Record<VoiceEvent, string>> | null;
  voiceName?: string | null;
  rate?: number | null;
  pitch?: number | null;
};

/** Itens que cada aviso pode falar (o que aparece como botão para inserir na frase). */
export const VOICE_VARIABLES: Record<VoiceEvent, { key: string; label: string; sample: string }[]> = {
  message: [
    { key: 'grupo', label: 'Nome do grupo', sample: 'Vendas SP' },
    { key: 'remetente', label: 'Quem enviou', sample: 'Carla' },
    { key: 'mensagem', label: 'Texto da mensagem', sample: 'Bom dia, o boleto não chegou' },
    { key: 'tipo_mensagem', label: 'Tipo (texto, imagem, áudio…)', sample: 'texto' },
  ],
  sla: [
    { key: 'grupo', label: 'Nome do grupo', sample: 'Vendas SP' },
    { key: 'espera', label: 'Tempo esperando', sample: '18 minutos' },
    { key: 'sla', label: 'SLA do grupo', sample: '15 minutos' },
    { key: 'pendentes', label: 'Mensagens sem resposta', sample: '2' },
    { key: 'remetente', label: 'Quem enviou', sample: 'Carla' },
    { key: 'mensagem', label: 'Texto da mensagem', sample: 'Bom dia, o boleto não chegou' },
  ],
  alert: [
    { key: 'tipo', label: 'Tipo do alerta', sample: 'Palavra-chave' },
    { key: 'gravidade', label: 'Gravidade', sample: 'crítico' },
    { key: 'grupo', label: 'Nome do grupo', sample: 'Vendas SP' },
    { key: 'titulo', label: 'Título do alerta', sample: 'Palavra-chave "urgente"' },
    { key: 'descricao', label: 'Descrição do alerta', sample: 'Carla: isso é urgente' },
  ],
};

export const DEFAULT_TEMPLATES: Record<VoiceEvent, string> = {
  message: 'Nova mensagem no grupo {grupo}, de {remetente}.',
  sla: 'Atenção: SLA excedido no grupo {grupo}, sem resposta há {espera}.',
  alert: 'Alerta: {tipo}, no grupo {grupo}.',
};

export const VOICE_EVENT_LABEL: Record<VoiceEvent, string> = {
  message: 'Mensagem nova',
  sla: 'SLA excedido',
  alert: 'Alertas das regras',
};

/** Frase configurada (ou a padrão) do aviso. */
export const templateFor = (options: VoiceOptions | null | undefined, event: VoiceEvent) =>
  options?.templates?.[event]?.trim() || DEFAULT_TEMPLATES[event];

/** Valores de exemplo, para ouvir a frase nas configurações. */
export const sampleValues = (event: VoiceEvent) =>
  Object.fromEntries(VOICE_VARIABLES[event].map((v) => [v.key, v.sample]));

/**
 * Troca os itens pelos valores. Item sem valor (ex.: alerta sem grupo) sai junto com a ligação
 * antes dele (", no grupo {grupo}" some inteiro), para a frase continuar natural.
 */
export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  let text = template;
  const keys = [...new Set([...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))];
  for (const key of keys) {
    const raw = values[key];
    const value = raw == null ? '' : String(raw).trim();
    const token = new RegExp(`\\{${key}\\}`, 'g');
    if (value) {
      text = text.replace(token, key === 'mensagem' || key === 'descricao' ? value.slice(0, 200) : value);
    } else {
      text = text.replace(new RegExp(`,?\\s*(?:(?:no|do|da|de|em|para)\\s+)?(?:grupo\\s+)?\\{${key}\\}`, 'g'), '');
    }
  }
  return text
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "18 minutos", "1 hora e 5 minutos" — tempo dito por extenso. */
export function spokenDuration(seconds: number) {
  const total = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hs = h === 1 ? '1 hora' : `${h} horas`;
  const ms = m === 1 ? '1 minuto' : `${m} minutos`;
  if (!h) return ms;
  return m ? `${hs} e ${ms}` : hs;
}

/** Tira emojis e símbolos que a voz leria de forma estranha. */
const speakable = (text: string) =>
  text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_~`#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Vozes do navegador, as em português primeiro. */
export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const rank = (v: SpeechSynthesisVoice) => (v.lang === 'pt-BR' ? 0 : v.lang?.toLowerCase().startsWith('pt') ? 1 : 2);
  return [...window.speechSynthesis.getVoices()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** A voz escolhida; se este computador não tiver, a melhor em português. */
function pickVoice(name?: string | null): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    (name ? voices.find((v) => v.name === name) : undefined) ??
    voices.find((v) => v.lang === 'pt-BR' && /google|natural|francisca|maria|luciana/i.test(v.name)) ??
    voices.find((v) => v.lang === 'pt-BR') ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('pt')) ??
    null
  );
}

/**
 * Fala a frase. Se chegarem muitos avisos de uma vez, descarta os mais antigos da fila para a
 * voz não ficar minutos atrasada.
 */
export function speak(text: string, options?: VoiceOptions | null, delayMs = 0) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const phrase = speakable(text);
    if (!phrase) return;
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(phrase);
    const voice = pickVoice(options?.voiceName);
    u.lang = voice?.lang ?? 'pt-BR';
    if (voice) u.voice = voice;
    u.rate = Number(options?.rate ?? 1) || 1;
    u.pitch = Number(options?.pitch ?? 1) || 1;
    u.volume = 1;
    setTimeout(() => synth.speak(u), delayMs);
  } catch {
    /* navegador sem voz */
  }
}

// as vozes carregam depois: pede a lista cedo para a primeira fala já sair na voz certa
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
}
