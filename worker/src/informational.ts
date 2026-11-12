/**
 * Mensagem do cliente que só INFORMA, sem pedir nada ("Sobre o processo X, sem movimentação, escritório está
 * acompanhando", "ciente", "para conhecimento"): não pede resposta e não abre pendência, como o "ok" e o "obrigado".
 *
 * Conservador de propósito: precisa de um marcador claro de informe e NÃO pode ter pergunta, pedido, prazo ou problema.
 * Na dúvida a mensagem continua pedindo resposta, para nunca esconder um pedido do cliente.
 */

const MARKERS = [
  'sem movimentacao', 'sem movimentacoes', 'sem movimento', 'sem andamento', 'sem novidade', 'sem novidades', 'sem alteracao',
  'sem alteracoes', 'esta acompanhando', 'estao acompanhando', 'estamos acompanhando', 'estou acompanhando', 'seguimos acompanhando',
  'seguimos monitorando', 'estamos monitorando', 'esta monitorando', 'ciente', 'cientes', 'estou ciente', 'estamos cientes',
  'para conhecimento', 'para ciencia', 'apenas informando', 'so informando', 'somente informando', 'informando que', 'informo que',
  'informamos que', 'so avisando', 'apenas avisando', 'somente avisando', 'aviso que',
];

/** Palavras que mostram pedido, dúvida, prazo ou problema: a mensagem pede resposta. */
const ASK_WORDS = new Set([
  'preciso', 'precisamos', 'precisa', 'necessito', 'necessitamos', 'poderia', 'poderiam', 'pode', 'podem', 'podes', 'consegue',
  'conseguem', 'conseguiria', 'gostaria', 'gostariamos', 'queria', 'queremos', 'quero', 'favor', 'solicito', 'solicitamos',
  'solicitar', 'quando', 'como', 'qual', 'quais', 'onde', 'porque', 'pq', 'cade', 'urgente', 'urgencia', 'problema', 'problemas',
  'erro', 'duvida', 'duvidas', 'pergunta', 'falta', 'faltou', 'faltando', 'atrasado', 'atrasada', 'atraso', 'pendente', 'pendencia',
  'envia', 'enviar', 'envie', 'enviem', 'manda', 'mandar', 'mande', 'verificar', 'verifica', 'verifiquem', 'confirmar', 'confirma',
  'confirmem', 'avisar', 'avise', 'avisem', 'informar', 'informe', 'informem', 'retorno', 'resposta', 'prazo', 'aguardo',
  'aguardamos', 'aguardando', 'nao', 'mas', 'porem', 'entretanto', 'contudo', 'ajuda', 'ajudar', 'ver', 'olhar', 'analisar',
]);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}? ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isInformational(type: string, body: string | null | undefined): boolean {
  if (type !== 'text' || !body) return false;
  if (body.length > 600 || body.includes('?')) return false;
  const text = ` ${normalize(body)} `;
  if (!MARKERS.some((m) => text.includes(` ${m} `))) return false;
  return !text
    .trim()
    .split(' ')
    .some((w) => ASK_WORDS.has(w));
}
