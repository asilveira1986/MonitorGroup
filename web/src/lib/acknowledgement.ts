/**
 * Mensagens a ignorar: agradecimentos e confirmações do cliente ("ok", "obrigado", 👍) que não
 * pedem resposta. Além da lista padrão, cada empresa cadastra as próprias frases
 * (Configurações › Respostas e mensagens › Mensagens a ignorar), ex.: "obrigado pelo retorno, doutora".
 *
 * Uma frase cadastrada vale quando a mensagem é ela (sem diferenciar acentos, maiúsculas e
 * pontuação) ou ela com sobras que também são de agradecimento/emoji ("Obrigado pelo retorno
 * doutora 🙏 valeu"). Pergunta ("…, mas e o prazo?") nunca é ignorada.
 *
 * ATENÇÃO: arquivo idêntico em worker/src/acknowledgement.ts e web/src/lib/acknowledgement.ts
 * (o painel testa as frases na hora). Um teste do worker confere que os dois são iguais.
 */

const ACKNOWLEDGEMENTS = new Set([
  'ok', 'okay', 'oks', 'okk', 'blz', 'beleza', 'obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu', 'vlw',
  'show', 'top', 'perfeito', 'certo', 'ta bom', 'tá bom', 'tudo bem', 'combinado', 'entendi', 'otimo', 'ótimo',
  'muito obrigado', 'muito obrigada', 'obrigado!', 'de nada', 'sim', 'ok obrigado', 'ok obrigada', 'joia', 'jóia',
]);

/** Palavras que, sozinhas ou combinadas, só agradecem ou confirmam. */
const ACK_WORDS = new Set([
  'ok', 'okay', 'oks', 'okk', 'blz', 'beleza', 'obrigado', 'obrigada', 'obrigadao', 'obg', 'brigado', 'brigada', 'valeu',
  'vlw', 'show', 'top', 'perfeito', 'perfeita', 'certo', 'ta', 'bom', 'tudo', 'bem', 'combinado', 'entendi', 'otimo',
  'otima', 'recebi', 'recebido', 'recebida', 'chegou', 'deu', 'funcionou', 'resolvido', 'joia', 'muito', 'mto', 'pela',
  'ajuda', 'demais', 'sim', 'de', 'nada', 'e', 'pessoal', 'gente', 'galera', 'tmj', 'abraco', 'abracos', 'fechado',
  'maravilha', 'excelente', 'agradeco', 'grato', 'grata',
  // retribuir o agradecimento ("eu que agradeço", "nós que agradecemos", "igualmente")
  'eu', 'que', 'nos', 'agradecemos', 'agradecido', 'agradecida', 'igualmente', 'voce', 'voces', 'vc', 'vcs', 'tambem', 'tb',
  // despedidas e votos ("bom final de semana", "boa semana", "até mais", "boa noite")
  'boa', 'otimo', 'final', 'fim', 'semana', 'feriado', 'descanso', 'dia', 'tarde', 'noite', 'ate', 'logo', 'mais', 'amanha',
  'tenha', 'tenham', 'pra', 'para', 'a', 'o', 'um', 'uma', 'att', 'atenciosamente', 'abs',
  // "qualquer dúvida só nos chamar", "fico à disposição"
  'qualquer', 'duvida', 'duvidas', 'so', 'chamar', 'chama', 'estamos', 'estou', 'fico', 'ficamos', 'disposicao', 'no', 'aguardo',
  // tratamento ("obrigado, doutora")
  'doutor', 'doutora', 'dr', 'dra', 'senhor', 'senhora', 'sr', 'sra',
]);

/** Exemplos mostrados na tela (a lista padrão, que vale sempre). */
export const DEFAULT_ACK_EXAMPLES = ['ok', 'obrigado', 'valeu', 'recebi, obrigado!', 'show, valeu pessoal', '👍', '🙏'];

const cleanAck = (body: string) =>
  body
    .trim()
    .toLowerCase()
    .replace(/[!.,;:?\s]+$/g, '')
    .replace(/\s+/g, ' ');

/** Sem acentos, minúsculas, só letras/números/emoji separados por um espaço. */
const normalizePhrase = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}?]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣\s]+$/u;

/** Figurinha ou mensagem só com emojis (👍, 🙏, 😊 ...). */
export function isStickerOrEmoji(type: string, body: string | null): boolean {
  if (type === 'sticker') return true;
  if (type !== 'text' || !body) return false;
  const cleaned = cleanAck(body);
  if (!cleaned || !/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(cleaned)) return false;
  return EMOJI_ONLY.test(cleaned);
}

/** Texto só com palavras de agradecimento/confirmação/despedida e emojis (até 8 palavras, sem pergunta). */
function onlyAckWords(cleaned: string): boolean {
  if (/\?/.test(cleaned)) return false;
  const words = cleaned
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean);
  // até 8 palavras: "Obrigada, bom final de semana para vocês" (pergunta já foi descartada acima)
  return words.length > 0 && words.length <= 8 && words.every((w) => ACK_WORDS.has(w));
}

/** A mensagem é uma das frases cadastradas (com sobras só de agradecimento/emoji)? */
export function matchIgnorePhrase(body: string | null, phrases: string[] | null | undefined): string | null {
  if (!body || !phrases?.length) return null;
  const text = ` ${normalizePhrase(body)} `;
  if (text.includes('?')) return null;
  for (const phrase of phrases) {
    const p = normalizePhrase(phrase);
    if (!p || !text.includes(` ${p} `)) continue;
    const rest = text.split(` ${p} `).join(' ').trim();
    if (!rest || EMOJI_ONLY.test(rest) || onlyAckWords(rest.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, ' ').trim())) {
      return phrase;
    }
  }
  return null;
}

/** Mensagem de confirmação/agradecimento que não exige resposta (lista padrão + frases da empresa). */
export function isAcknowledgement(type: string, body: string | null, phrases?: string[] | null): boolean {
  if (isStickerOrEmoji(type, body)) return true;
  if (type !== 'text' || !body) return false;
  const cleaned = cleanAck(body);
  if (!cleaned) return false;
  if (ACKNOWLEDGEMENTS.has(cleaned)) return true;
  if (matchIgnorePhrase(body, phrases)) return true;
  // frase curta só com palavras de agradecimento/confirmação ("Recebi, obrigado!", "show, valeu 👍")
  return onlyAckWords(cleaned);
}
