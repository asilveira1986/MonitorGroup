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
  // o cliente diz que vai ver/verificar ("vou verificar", "já verifico"): a bola está com ele
  'vou verificar', 'vou ver', 'vou ver isso', 'vou olhar', 'vou analisar', 'vou conferir', 'vou checar', 'vou procurar', 'vou providenciar',
  'vou dar uma olhada', 'ja verifico', 'ja vejo', 'verifico e retorno', 'vejo e retorno', 'ja te retorno', 'ja retorno', 'ja te aviso',
  // "assim que tivermos retorno, informo no grupo": avisa que vai informar, não pede nada
  'assim que tivermos algum retorno', 'assim que tivermos retorno', 'assim que tiver algum retorno', 'assim que tiver retorno',
  'assim que tivermos', 'assim que tiver', 'assim que houver', 'assim que souber', 'assim que soubermos', 'informo no grupo',
  'informo aqui', 'informo voces', 'informo vcs', 'informamos no grupo', 'aviso no grupo', 'aviso aqui', 'comunico no grupo',
];

/** Trechos que dizem "ainda sem resposta/novidade" (o "não" daqui não é pedido nem problema). */
const NEUTRAL = ['ainda nao ha', 'ainda nao tivemos', 'ainda nao temos', 'ainda nao tive', 'ainda nao tenho', 'ainda nao', 'nao ha novidade', 'nao ha novidades', 'nao tivemos retorno', 'nao temos retorno'];

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
  // os mais longos primeiro (um marcador pode conter o outro: "assim que tivermos algum retorno" x "assim que tivermos")
  for (const m of [...MARKERS].sort((x, y) => y.length - x.length)) rest = rest.split(` ${m} `).join(' ');
  for (const n of [...NEUTRAL].sort((x, y) => y.length - x.length)) rest = rest.split(` ${n} `).join(' ');
  return !rest
    .trim()
    .split(' ')
    .some((w) => ASK_WORDS.has(w));
}
