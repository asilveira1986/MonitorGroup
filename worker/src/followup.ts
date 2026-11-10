/**
 * Pendência da conversa por regras, sem IA (0167): lê as últimas mensagens do grupo, na ordem, e diz com quem ficou a
 * próxima ação.
 *
 *  - EMPRESA: o cliente perguntou/pediu/escreveu e a equipe não respondeu; a equipe PROMETEU algo ("vou verificar e te
 *    retorno", "fico de enviar") e ainda não entregou; ou o cliente mandou o que foi pedido e falta a equipe conferir.
 *  - CLIENTE: a equipe pediu algo ao cliente ("favor enviar o RG", "pode assinar?") e ele ainda não mandou.
 *  - Sem pendência: a equipe respondeu, entregou ("segue em anexo", "pronto", arquivo enviado) ou encerrou (mensagem de
 *    fechamento), ou o cliente agradeceu depois do retorno.
 *
 * Promessa: os mesmos gatilhos de compromisso das demandas (`findCommitment`). Prazo citado ("até sexta", "em 2 dias"):
 * `parsePromise`, o mesmo das demandas. Frases de pedido ao cliente e de entrega são configuráveis por empresa.
 *
 * Arquivo puro (sem banco nem WhatsApp): o worker busca as mensagens, chama `classifyFollowup` e grava o resultado.
 */
import { findCommitment } from './commitment.js';
import { parsePromise } from './dates.js';
import { DEFAULT_DELIVERY_PHRASES, DEFAULT_REQUEST_PHRASES } from './followup-phrases.js';

export { DEFAULT_DELIVERY_PHRASES, DEFAULT_REQUEST_PHRASES };

export type FollowupMessage = {
  id: string;
  fromTeam: boolean;
  type: string;
  body: string | null;
  /** quando foi enviada (ms) */
  at: number;
  sender: string | null;
  /** false = confirmação/agradecimento/figurinha do cliente (não pede resposta), como já calculado na gravação */
  opensPending: boolean;
  /** mensagem de fechamento da conversa */
  closes: boolean;
};

export type FollowupStatus = 'company' | 'client' | 'resolved';
export type FollowupKind =
  | 'question' // cliente perguntou/pediu
  | 'reply' // cliente escreveu e ninguém respondeu
  | 'promise' // equipe prometeu
  | 'received' // cliente mandou o que foi pedido; falta a equipe conferir
  | 'request' // equipe pediu algo ao cliente
  | 'answered'
  | 'delivered'
  | 'closed'
  | 'thanked';

export type FollowupResult = {
  status: FollowupStatus | null;
  kind: FollowupKind | null;
  /** frase pronta para a tela, ex.: "Promessa da equipe sem entrega" */
  reason: string | null;
  /** trecho da mensagem que decidiu (até 140 caracteres) */
  excerpt: string | null;
  /** gatilho encontrado ("vou verificar", "favor enviar"), se houver */
  trigger: string | null;
  messageId: string | null;
  /** desde quando a pendência existe (ms) */
  since: number | null;
  /** prazo citado na promessa ou no pedido (ms) */
  dueAt: number | null;
  /** quem deixou a pendência ou resolveu */
  actor: string | null;
};

export type FollowupOptions = {
  commitmentVerbs: string[];
  commitmentPhrases: string[];
  requestPhrases?: string[] | null;
  deliveryPhrases?: string[] | null;
  timeZone: string;
  businessEnd: string;
};

/** Perguntas de cortesia da equipe: terminam em "?", mas não deixam nada com o cliente. */
const COURTESY = [
  'tudo bem', 'tudo bom', 'como vai', 'como esta', 'posso ajudar', 'podemos ajudar', 'ajudo em algo', 'em que posso',
  'algo mais', 'mais alguma', 'alguma duvida', 'ficou alguma duvida', 'ficou claro', 'certo', 'ok', 'bom dia', 'boa tarde',
  'boa noite',
];

/** Pedido/pergunta do cliente (além do "?"). */
const CLIENT_ASKS = [
  'pode me', 'podem me', 'poderia', 'poderiam', 'consegue', 'conseguem', 'preciso', 'precisamos', 'gostaria', 'por favor',
  'por gentileza', 'favor', 'solicito', 'solicitamos', 'aguardo retorno', 'aguardo resposta', 'alguem pode', 'alguem para',
  'urgente', 'quando', 'qual o', 'qual a', 'quais',
];

const FILE_TYPES = new Set(['image', 'video', 'document']);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?/ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Primeira frase da lista que aparece como palavras inteiras no texto (já normalizado com espaços nas pontas). */
function findPhrase(text: string, phrases: string[]): string | null {
  let best: { phrase: string; index: number } | null = null;
  for (const raw of phrases) {
    const p = normalize(raw);
    if (!p) continue;
    const index = text.indexOf(` ${p} `);
    if (index >= 0 && (!best || index < best.index)) best = { phrase: raw.trim(), index };
  }
  return best?.phrase ?? null;
}

const excerptOf = (body: string | null) => {
  const t = (body ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > 140 ? `${t.slice(0, 139)}…` : t) : null;
};

/**
 * Mensagem institucional (apresentação da empresa, aviso geral, plantão): não é conversa sobre um assunto, então o
 * classificador a ignora por inteiro: não abre pendência, não conta como resposta nem como entrega.
 * Vale com o texto de apresentação (frases típicas) ou com mensagem longa assinada (mais de 700 caracteres).
 */
const INSTITUTIONAL_MARKERS = [
  'reforcar nosso compromisso', 'nosso contato e para', 'estamos prontos para atende', 'estamos a disposicao para',
  'caso tenha alguma demanda', 'basta nos informar aqui', 'sempre que necessario, entraremos em contato',
  'seja bem-vindo', 'seja bem vindo', 'e um prazer atende', 'informo que estarei responsavel pelo plantao',
  'informamos que o escritorio', 'comunicado', 'aviso importante', 'feliz natal', 'feliz ano novo', 'boas festas',
];
const SIGNATURE = /\b(atenciosamente|cordialmente|abracos|cordiais cumprimentos)\b/;
const MAX_SIGNED_MESSAGE = 700;
const MIN_INSTITUTIONAL = 160;

export function isInstitutional(body: string | null | undefined): boolean {
  if (!body || body.length < MIN_INSTITUTIONAL) return false;
  const plain = normalize(body);
  if (body.length > MAX_SIGNED_MESSAGE && SIGNATURE.test(plain)) return true;
  const hits = INSTITUTIONAL_MARKERS.filter((m) => plain.includes(normalize(m))).length;
  return hits >= 2 || (hits >= 1 && SIGNATURE.test(plain));
}

/** A frase só promete se algo acontecer ("caso tenha...", "sempre que necessário...", "qualquer dúvida..."). */
const CONDITIONAL = /\b(caso|se|sempre que|quando|qualquer|eventual|eventuais|havendo|na hipotese|se necessario|se precisar)\b/;

/**
 * Promessa de verdade: um compromisso com algo específico ("vou verificar e te retorno"). Não conta o que é condicional
 * ("caso tenha alguma demanda, retornaremos") nem aviso institucional longo, assinado ("Atenciosamente, Flores Advogados").
 * A promessa é procurada frase por frase, para a condição de uma frase não valer para a outra.
 */
export function findSpecificPromise(body: string | null | undefined, verbs: string[] | null | undefined, phrases: string[] | null | undefined) {
  if (!body) return null;
  if (isInstitutional(body)) return null;
  for (const sentence of body.split(/(?<=[.!?:])\s+|\n+/)) {
    const found = findCommitment(sentence, verbs, phrases);
    if (!found) continue;
    const s = ` ${normalize(sentence)} `;
    const at = s.indexOf(normalize(found.trigger));
    // condição antes do gatilho, na mesma frase: promessa condicional, não vale
    if (at > 0 && CONDITIONAL.test(s.slice(0, at))) continue;
    return found;
  }
  return null;
}

/** Alguma frase da mensagem é pergunta de verdade (termina em "?") e não só cortesia ("tudo bem?", "algo mais?"). */
function asksQuestion(body: string | null): boolean {
  if (!body || !body.includes('?')) return false;
  const plain = body
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const questions = plain
    .split('?')
    .slice(0, -1)
    .map((q) => normalize(q.split(/[.!\n]/).pop() ?? ''))
    .filter(Boolean);
  return questions.some((q) => {
    const words = q.split(' ').length;
    const courtesy = COURTESY.some((c) => ` ${q} `.includes(` ${c} `));
    return !(courtesy && words <= 6);
  });
}

type State = {
  status: FollowupStatus | null;
  kind: FollowupKind | null;
  msg: FollowupMessage | null;
  since: number | null;
  trigger: string | null;
  dueAt: number | null;
  /** a equipe falou depois da promessa (um "obrigado" do cliente então encerra) */
  teamAfterPromise: boolean;
};

export function classifyFollowup(messages: FollowupMessage[], opts: FollowupOptions): FollowupResult {
  const requestPhrases = opts.requestPhrases?.length ? opts.requestPhrases : DEFAULT_REQUEST_PHRASES;
  const deliveryPhrases = opts.deliveryPhrases?.length ? opts.deliveryPhrases : DEFAULT_DELIVERY_PHRASES;
  const due = (m: FollowupMessage) => parsePromise(m.body, new Date(m.at), { timeZone: opts.timeZone, businessEnd: opts.businessEnd })?.getTime() ?? null;

  let s: State = { status: null, kind: null, msg: null, since: null, trigger: null, dueAt: null, teamAfterPromise: false };
  const set = (status: FollowupStatus, kind: FollowupKind, m: FollowupMessage, extra: Partial<State> = {}) => {
    // pendência que continua do mesmo lado e do mesmo tipo: mantém desde quando começou
    const keepSince = s.status === status && s.kind === kind && (kind === 'question' || kind === 'reply');
    s = { status, kind, msg: m, since: keepSince ? s.since : m.at, trigger: null, dueAt: null, teamAfterPromise: false, ...extra };
  };

  for (const m of [...messages].sort((a, b) => a.at - b.at)) {
    const text = ` ${normalize(m.body ?? '')} `;
    const hasFile = FILE_TYPES.has(m.type);

    if (m.fromTeam) {
      // apresentação/aviso geral da empresa: fora da conta, sem abrir pendência nem resolver nenhuma (0167)
      if (m.type === 'text' && !m.closes && isInstitutional(m.body)) continue;
      if (m.closes) {
        set('resolved', 'closed', m);
        continue;
      }
      const promise = m.type === 'text' ? findSpecificPromise(m.body, opts.commitmentVerbs, opts.commitmentPhrases) : null;
      if (promise) {
        set('company', 'promise', m, { trigger: promise.trigger, dueAt: due(m) });
        continue;
      }
      const request = findPhrase(text, requestPhrases) ?? (asksQuestion(m.body) ? '?' : null);
      if (request) {
        set('client', 'request', m, { trigger: request === '?' ? null : request, dueAt: due(m) });
        continue;
      }
      const delivery = hasFile ? 'arquivo' : findPhrase(text, deliveryPhrases);
      if (delivery) {
        set('resolved', 'delivered', m, { trigger: delivery === 'arquivo' ? null : delivery });
        continue;
      }
      // resposta comum: responde o que o cliente perguntou/escreveu; promessa e pedido ao cliente continuam
      if (s.status === 'company' && s.kind !== 'promise') set('resolved', 'answered', m);
      else if (s.kind === 'promise') s.teamAfterPromise = true;
      else if (s.status === null) set('resolved', 'answered', m);
      continue;
    }

    // cliente
    if (!m.opensPending) {
      // "obrigado"/"ok" depois do retorno da equipe à promessa: encerrado; nos outros casos não muda nada
      if (s.kind === 'promise' && s.teamAfterPromise) set('resolved', 'thanked', m);
      continue;
    }
    if (s.status === 'client' && (hasFile || findPhrase(text, deliveryPhrases))) {
      set('company', 'received', m);
      continue;
    }
    // promessa em aberto: o cliente cobrar ou escrever de novo não apaga a promessa
    if (s.kind === 'promise') continue;
    const asks = text.includes('?') || findPhrase(text, CLIENT_ASKS);
    set('company', asks ? 'question' : 'reply', m);
  }

  if (!s.status || !s.kind || !s.msg) {
    return { status: null, kind: null, reason: null, excerpt: null, trigger: null, messageId: null, since: null, dueAt: null, actor: null };
  }
  return {
    status: s.status,
    kind: s.kind,
    reason: REASON[s.kind],
    excerpt: excerptOf(s.msg.body) ?? (FILE_TYPES.has(s.msg.type) ? `[${s.msg.type === 'image' ? 'imagem' : s.msg.type === 'video' ? 'vídeo' : 'documento'}]` : null),
    trigger: s.trigger,
    messageId: s.msg.id,
    since: s.since,
    dueAt: s.dueAt,
    actor: s.msg.sender,
  };
}

export const REASON: Record<FollowupKind, string> = {
  question: 'Pergunta ou pedido do cliente sem resposta',
  reply: 'Mensagem do cliente sem resposta',
  promise: 'Promessa da equipe ainda sem entrega',
  received: 'Cliente enviou o que foi pedido; falta a equipe conferir',
  request: 'Equipe pediu algo ao cliente e aguarda',
  answered: 'Equipe respondeu',
  delivered: 'Equipe entregou o que foi pedido',
  closed: 'Conversa encerrada pela equipe',
  thanked: 'Cliente agradeceu depois do retorno',
};
