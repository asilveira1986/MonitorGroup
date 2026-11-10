// CÓPIA IDÊNTICA: este arquivo existe também em worker/src/followup-phrases.ts e web/src/lib/followup-phrases.ts (o painel
// mostra as listas padrão em Configurações; o worker usa na pendência da conversa, 0167). Altere nos dois lugares: o teste
// worker/src/followup.test.ts falha se divergirem.

/** Pedidos da equipe ao cliente (configuráveis em Configurações › Respostas e mensagens › Pendências da conversa). */
export const DEFAULT_REQUEST_PHRASES = [
  'favor enviar', 'favor encaminhar', 'favor assinar', 'favor confirmar', 'favor nos enviar', 'favor nos retornar',
  'por favor envie', 'por favor encaminhe', 'por favor assine', 'por favor confirme', 'por gentileza envie',
  'pode enviar', 'pode nos enviar', 'pode me enviar', 'pode encaminhar', 'pode assinar', 'pode confirmar',
  'poderia enviar', 'poderia nos enviar', 'poderia encaminhar', 'poderia assinar', 'poderia confirmar',
  'consegue enviar', 'consegue nos enviar', 'consegue assinar', 'consegue confirmar',
  'precisamos do', 'precisamos da', 'precisamos de', 'preciso do', 'preciso da', 'preciso que',
  'aguardamos o', 'aguardamos a', 'aguardamos seu', 'aguardamos sua', 'aguardamos retorno', 'aguardo o', 'aguardo a',
  'aguardo seu', 'aguardo sua', 'aguardo retorno', 'fico no aguardo', 'ficamos no aguardo', 'no aguardo do', 'no aguardo da',
  'nos envie', 'me envie', 'encaminhe', 'envie o', 'envie a', 'envie os', 'envie as', 'assine', 'nos retorne', 'me retorne',
  'nos confirme', 'me confirme', 'falta o', 'falta a', 'faltam os', 'faltam as',
  'pode me passar', 'pode nos passar', 'pode passar', 'me passe', 'nos passe', 'pode me informar', 'pode nos informar', 'pode informar',
  'me informe', 'nos informe', 'me avise', 'nos avise', 'pode me avisar', 'pode nos avisar', 'quando conseguir', 'assim que tiver',
  'assim que puder', 'quando tiver',
];

/** Entregas da equipe (e do cliente, quando foi pedido algo a ele). */
export const DEFAULT_DELIVERY_PHRASES = [
  'segue', 'seguem', 'em anexo', 'anexo', 'anexado', 'anexada', 'enviado', 'enviada', 'enviados', 'enviadas', 'encaminhado',
  'encaminhada', 'pronto', 'pronta', 'prontos', 'prontas', 'concluido', 'concluida', 'finalizado', 'finalizada', 'resolvido',
  'resolvida', 'feito', 'feita', 'corrigido', 'corrigida', 'ajustado', 'ajustada', 'atualizado', 'atualizada', 'protocolado',
  'protocolada', 'assinado', 'assinada', 'verifiquei', 'verificamos', 'conferi', 'conferimos', 'conforme solicitado',
  'ja esta', 'ja foi', 'ja enviei', 'ja enviamos', 'ja mandei', 'ja mandamos', 'acabei de enviar', 'acabamos de enviar',
];

