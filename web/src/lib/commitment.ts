/**
 * Gatilhos de compromisso da equipe: reconhece na resposta do atendente que ele assumiu uma tarefa
 * ("irei verificar e te retorno", "vou corrigir", "já estou ajustando", "verificarei", "fico de enviar").
 *
 * Duas fontes, sem diferenciar acentos/maiúsculas:
 *  - frases prontas (ex.: "te retorno", "dar uma olhada"): basta aparecer no texto;
 *  - verbos de ação no infinitivo (ex.: verificar, corrigir, realizar): valem em qualquer forma de compromisso:
 *      vou / vamos / irei / iremos / vou estar / estou / estamos / tô / fico de / ficamos de / já ... + verbo
 *      com até 3 palavras de ligação no meio ("vou já te enviar", "a gente vai sim verificar"),
 *      no gerúndio ("estou verificando", "já corrigindo"), no futuro ("verificarei", "corrigiremos")
 *      e no presente com "já"/"eu" ("já verifico", "pode deixar que eu corrijo").
 *  - negação logo antes ("não vou conseguir verificar", "não irei corrigir") não conta.
 *
 * Arquivo puro, sem dependências: o painel usa uma cópia idêntica (web/src/lib/commitment.ts)
 * para o teste de frases nas configurações. Um teste do worker garante que as duas são iguais.
 */

export const DEFAULT_COMMITMENT_VERBS = [
  'verificar', 'checar', 'conferir', 'analisar', 'olhar', 'ver', 'avaliar', 'investigar', 'revisar', 'validar', 'testar',
  'corrigir', 'ajustar', 'arrumar', 'consertar', 'resolver', 'solucionar', 'tratar', 'atualizar', 'alterar', 'configurar',
  'realizar', 'fazer', 'executar', 'providenciar', 'preparar', 'organizar', 'programar', 'agendar', 'cadastrar', 'liberar',
  'enviar', 'mandar', 'encaminhar', 'emitir', 'gerar', 'entregar', 'finalizar', 'concluir', 'retornar', 'responder',
  'avisar', 'confirmar', 'levantar', 'solicitar', 'acompanhar', 'alinhar', 'buscar', 'separar', 'instalar', 'refazer',
];

export type CommitmentMatch = { trigger: string; kind: 'phrase' | 'verb' };

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.,;:!?]+/g, ' | ') // pontuação separa frases ("não, vou verificar" não é negação)
    .replace(/[^\p{L}\p{N}|]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Formas que indicam compromisso antes do verbo. */
const AUX =
  'vou|vamos|vo|vai|vao|irei|iremos|ire|ira|irao|estou|estamos|esta|estao|to|tamo|tamos|fico de|ficamos de|fiquei de|ficou de|' +
  'vou estar|vamos estar|vai estar|irei estar|ja|ja ja';
/** Palavras que podem aparecer entre o auxiliar e o verbo ("vou já te enviar", "vamos sim verificar"). */
const FILLER =
  'ja|agora|logo|entao|sim|aqui|hoje|amanha|ainda|tambem|tb|so|mesmo|rapidinho|novamente|pessoalmente|te|lhe|lhes|vos|o|a|os|as|estar|ficar|eu|nos|a gente';
const NEGATION = /(^|\s)(nao|nunca|nem|jamais)\s+$/;

/** Formas do verbo: gerúndio, futuro (1ª pessoa) e presente (1ª pessoa, só com "já"). */
function forms(verb: string): { infinitive: string; gerund: string; future: string[]; present: string } | null {
  const v = normalize(verb);
  const m = /^(.+)(ar|er|ir)$/.exec(v);
  if (!m || v.includes(' ')) return null;
  const [, stem, end] = m;
  const irregularFuture: Record<string, string[]> = { fazer: ['farei', 'faremos'], refazer: ['refarei', 'refaremos'], trazer: ['trarei', 'traremos'], dizer: ['direi', 'diremos'] };
  const irregularPresent: Record<string, string> = { fazer: 'faco', refazer: 'refaco', ver: 'vejo', conferir: 'confiro', trazer: 'trago', dizer: 'digo' };
  return {
    infinitive: v,
    gerund: `${stem}${end[0]}ndo`,
    future: irregularFuture[v] ?? [`${v}ei`, `${v}emos`],
    present: irregularPresent[v] ?? (end === 'ir' ? `${stem.replace(/g$/, 'j')}o` : `${stem}o`),
  };
}

function search(text: string, pattern: RegExp): { index: number; match: string } | null {
  for (const m of text.matchAll(pattern)) {
    const index = (m.index ?? 0) + m[1].length;
    if (!NEGATION.test(text.slice(0, index))) return { index, match: m[0].slice(m[1].length).trim() };
  }
  return null;
}

/** Primeiro gatilho de compromisso encontrado no texto (ou null). */
export function findCommitment(
  text: string | null | undefined,
  verbs: string[] | null | undefined,
  phrases: string[] | null | undefined,
): CommitmentMatch | null {
  if (!text) return null;
  const t = ` ${normalize(text)} `;
  let best: (CommitmentMatch & { index: number }) | null = null;
  const keep = (found: { index: number; match: string } | null, kind: CommitmentMatch['kind']) => {
    if (found && (!best || found.index < best.index)) best = { trigger: found.match, kind, index: found.index };
  };

  for (const phrase of phrases ?? []) {
    const p = normalize(phrase);
    if (p) keep(search(t, new RegExp(`(\\s)${escape(p)}(?=\\s)`, 'g')), 'phrase');
  }

  const all = (verbs ?? []).map(forms).filter((f): f is NonNullable<ReturnType<typeof forms>> => f !== null);
  if (all.length) {
    const alt = (xs: string[]) => xs.map(escape).join('|');
    const withAux = alt(all.flatMap((f) => [f.infinitive, f.gerund]));
    const fillers = `(?:(?:${FILLER})\\s+){0,3}`;
    keep(search(t, new RegExp(`(\\s)(?:${AUX})\\s+${fillers}(?:${withAux})(?=\\s)`, 'g')), 'verb');
    // futuro sozinho já é compromisso ("verificarei", "corrigiremos")
    keep(search(t, new RegExp(`(\\s)(?:${alt(all.flatMap((f) => f.future))})(?=\\s)`, 'g')), 'verb');
    // presente com "já" ou "eu" ("já verifico", "pode deixar que eu corrijo")
    keep(search(t, new RegExp(`(\\s)(?:ja|eu)\\s+(?:${alt(all.map((f) => f.present))})(?=\\s)`, 'g')), 'verb');
  }
  const found = best as (CommitmentMatch & { index: number }) | null;
  return found ? { trigger: found.trigger, kind: found.kind } : null;
}
