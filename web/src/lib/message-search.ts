/**
 * Pesquisa de mensagens (como no WhatsApp): acha o texto sem diferenciar maiúsculas nem acentos.
 * Sem dependências, para as telas e os testes usarem o mesmo código.
 */

const fold = (ch: string) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texto sem acento e em minúsculas, com o índice de cada letra no texto original. */
function folded(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let k = 0; k < f.length; k++) {
      norm += f[k];
      map.push(i);
    }
  }
  return { norm, map };
}

/** Os trechos [start, end) do texto original que casam com a busca (sem repetir sobreposições). */
export function findMatches(text: string, term: string): { start: number; end: number }[] {
  const t = folded(term.trim()).norm;
  if (!t || !text) return [];
  const { norm, map } = folded(text);
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const at = norm.indexOf(t, from);
    if (at < 0) break;
    const start = map[at];
    const end = map[at + t.length - 1] + 1;
    out.push({ start, end });
    from = at + t.length;
  }
  return out;
}

/** Trecho curto em volta da primeira ocorrência, para a lista de resultados. */
export function snippet(body: string, term: string, radius = 40): { before: string; match: string; after: string } {
  const flat = body.replace(/\s+/g, ' ').trim();
  const m = findMatches(flat, term)[0];
  if (!m) return { before: flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat, match: '', after: '' };
  const a = Math.max(0, m.start - radius);
  const b = Math.min(flat.length, m.end + radius);
  return { before: `${a > 0 ? '…' : ''}${flat.slice(a, m.start)}`, match: flat.slice(m.start, m.end), after: `${flat.slice(m.end, b)}${b < flat.length ? '…' : ''}` };
}

/** A pesquisa só começa com 2 letras ou mais (o banco também exige). */
export const MIN_SEARCH_CHARS = 2;
