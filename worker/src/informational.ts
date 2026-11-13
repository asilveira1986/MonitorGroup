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
  // o próprio cliente diz que vai retornar: a bola está com ele, não com a empresa
  'dou retorno', 'darei retorno', 'dou um retorno', 'te dou retorno', 'logo retorno', 'retorno em breve', 'em breve retorno',
  'te retorno', 'retornarei', 'retornamos assim que', 'volto a falar', 'volto com', 'dou noticias', 'te aviso', 'aviso assim que',
  'aviso quando',
];

/** Palavras que mostram pedido, dúvida, prazo ou problema: a mensagem pede resposta. */
const ASK_WORDS = new Set([
  'preciso', 'precisamos', 'precisa', 'necessito', 'necessitamos', 'poderia', 'poderiam', 'pode', 'podem', 'podes', 'consegue',
  'conseguem', 'conseguiria', 'gostaria', 'gostariamos', 'queria', 'queremos', 'quero', 'favor', 'solicito', 'solicitamos',
  'solicitar', 'quando', 'como', 'qual', 'quais', 'onde', 'porque', 'pq', 'cade', 'urgente', 'urgencia', 'problema', 'problemas',
  'erro', 'duvida', 'duvidas', 'pergunta', 'falta', 'faltou', 'faltando', 'atrasado', 'atrasada', 'atraso',
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
  const found = MARKERS.filter((m) => text.includes(` ${m} `));
  if (!found.length) return false;
  // as palavras do próprio marcador não contam como pedido ("dou retorno": "retorno" é parte do aviso)
  let rest = text;
  for (const m of found) rest = rest.split(` ${m} `).join(' ');
  return !rest
    .trim()
    .split(' ')
    .some((w) => ASK_WORDS.has(w));
}
