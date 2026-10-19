/**
 * Mensagens rápidas: textos prontos da empresa inseridos na caixa de resposta com \atalho.
 * Itens entre chaves são trocados na hora: {cliente}, {grupo}, {atendente}, {saudacao}.
 */
export type QuickReply = { id: string; shortcut: string; title: string | null; body: string };

export const QUICK_REPLY_VARIABLES = [
  { key: 'saudacao', label: 'Saudação (bom dia / boa tarde / boa noite)' },
  { key: 'cliente', label: 'Nome do cliente (da mensagem respondida)' },
  { key: 'grupo', label: 'Nome do grupo' },
  { key: 'atendente', label: 'Seu nome' },
] as const;

/** "Boleto 2ª via" -> "boleto-2-via": minúsculas, sem acento, letras/números/-/_ */
export function normalizeShortcut(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\\+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30);
}

/** Saudação pelo horário (do navegador de quem responde). */
export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite';
}

/** Troca os itens; item sem valor some (com o espaço antes, se houver). */
export function renderQuickReply(body: string, values: Partial<Record<string, string | null | undefined>>) {
  return body
    .replace(/(\s?)\{(\w+)\}/g, (match, space: string, key: string) => {
      if (!(key in values)) return match;
      const v = values[key]?.trim();
      return v ? `${space}${v}` : '';
    })
    .replace(/ +([,.!?])/g, '$1')
    // item vazio deixa pontuação sobrando: "Boa tarde,!" -> "Boa tarde!"
    .replace(/,+(?=[.!?;:])/g, '')
    .replace(/,{2,}/g, ',')
    .replace(/^[\s,]+/, '');
}

/**
 * Atalho sendo digitado antes do cursor: "\" no início ou depois de espaço, seguido do atalho.
 * Devolve onde começa (posição da barra) e o que já foi digitado.
 */
export function findShortcutTrigger(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)\\([a-z0-9_-]*)$/i);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

/** Atalhos que combinam com o digitado: primeiro os que começam com ele, depois os que contêm. */
export function matchQuickReplies(list: QuickReply[], query: string, limit = 8) {
  const q = normalizeShortcut(query);
  const starts = list.filter((r) => r.shortcut.startsWith(q));
  const contains = list.filter(
    (r) => !r.shortcut.startsWith(q) && (r.shortcut.includes(q) || (r.title ?? '').toLowerCase().includes(q)),
  );
  return [...starts, ...contains].slice(0, limit);
}
