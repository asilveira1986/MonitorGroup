/**
 * Menções (@pessoa) na resposta do grupo, como no WhatsApp: ao digitar "@" abre a lista dos participantes do
 * grupo; escolher alguém põe "@Nome" no texto. No envio, "@Nome" vira "@número" e a pessoa vai na lista de
 * menções da mensagem (o WhatsApp mostra o nome e avisa a pessoa). Sem dependências, para o painel e os
 * testes usarem o mesmo código.
 */

export type MentionMember = {
  /** identificador do participante no WhatsApp (telefone ou LID) */
  jid: string;
  lid?: string | null;
  phone: string | null;
  name: string | null;
  /** o próprio número conectado: não aparece na lista */
  is_me?: boolean;
};

/** Uma pessoa escolhida na lista: o texto que ficou na caixa e a quem ele se refere. */
export type PickedMention = { token: string; jid: string };

const strip = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Só o que vem antes do "@" no identificador (o número ou o LID). */
export const mentionDigits = (jid: string) => jid.split('@')[0].split(':')[0];

/** Nome mostrado na lista e no texto: o nome do participante, ou o telefone, ou o número do identificador. */
export function mentionLabel(m: MentionMember): string {
  return (m.name && m.name.trim()) || m.phone || mentionDigits(m.jid);
}

/**
 * Há um "@" sendo digitado logo antes do cursor? ("@" no começo ou depois de espaço; o que vem depois, sem
 * espaço, é a busca). Com espaço no meio a busca continua enquanto o texto casar com um nome (ex.: "@Maria Si").
 */
export function findMentionTrigger(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]*(?: [^\s@]+){0,3}[^\s@]?)$/);
  if (!m) return null;
  const query = m[2];
  // uma frase longa depois do "@" é texto comum, não busca
  if (query.length > 40) return null;
  return { start: caret - query.length - 1, query };
}

/** Participantes que combinam com a busca (nome sem acento ou parte do telefone), os que começam com ela primeiro. */
export function filterMentionMembers(members: MentionMember[], query: string, limit = 8): MentionMember[] {
  const q = strip(query.trim());
  const digits = query.replace(/\D/g, '');
  const usable = members.filter((m) => !m.is_me && m.jid);
  if (!q) return usable.slice(0, limit);
  const rank = (m: MentionMember) => {
    const name = strip(mentionLabel(m));
    if (name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    if (digits.length >= 3 && ((m.phone ?? '').includes(digits) || mentionDigits(m.jid).includes(digits))) return 3;
    return -1;
  };
  return usable
    .map((m, i) => ({ m, r: rank(m), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}

/**
 * Troca no texto cada "@Nome" escolhido por "@número" e devolve as pessoas marcadas. Uma menção cujo texto foi
 * editado ou apagado depois de escolher não vale. Nomes parecidos ("@Ana" e "@Ana Paula") não se confundem: os
 * mais compridos são trocados primeiro; nomes iguais seguem a ordem em que foram escolhidos.
 */
export function applyMentions(text: string, picked: PickedMention[]): { text: string; mentions: string[] } {
  const order = picked.map((p, index) => ({ ...p, index })).sort((a, b) => b.token.length - a.token.length || a.index - b.index);
  const mentions = new Set<string>();
  let out = text;
  for (const p of order) {
    const at = findToken(out, p.token);
    if (at < 0) continue;
    out = `${out.slice(0, at)}@${mentionDigits(p.jid)}${out.slice(at + p.token.length)}`;
    mentions.add(p.jid);
  }
  return { text: out, mentions: [...mentions] };
}

/** Primeira ocorrência do "@Nome" que não faz parte de uma palavra maior. */
function findToken(text: string, token: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) return -1;
    const prev = at === 0 ? ' ' : text[at - 1];
    const next = text[at + token.length] ?? ' ';
    if (/\s/.test(prev) || /[(\[{"'“]/.test(prev)) {
      if (!/[\p{L}\p{N}_]/u.test(next)) return at;
    }
    from = at + 1;
  }
}
