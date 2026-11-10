import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COMMITMENT_VERBS } from './commitment.js';
import { classifyFollowup, type FollowupMessage } from './followup.js';

const T0 = Date.UTC(2026, 10, 3, 13, 0, 0); // terça, 10h em Brasília
let n = 0;
const at = (min: number) => T0 + min * 60_000;
const client = (body: string, min: number, extra: Partial<FollowupMessage> = {}): FollowupMessage => ({
  id: `m${++n}`, fromTeam: false, type: 'text', body, at: at(min), sender: 'Cliente', opensPending: true, closes: false, ...extra,
});
const team = (body: string, min: number, extra: Partial<FollowupMessage> = {}): FollowupMessage => ({
  id: `m${++n}`, fromTeam: true, type: 'text', body, at: at(min), sender: 'Julia', opensPending: false, closes: false, ...extra,
});
const opts = { commitmentVerbs: DEFAULT_COMMITMENT_VERBS, commitmentPhrases: ['te retorno', 'dar uma olhada'], timeZone: 'America/Sao_Paulo', businessEnd: '18:00' };
const run = (msgs: FollowupMessage[]) => classifyFollowup(msgs, opts);

test('pergunta do cliente sem resposta: empresa, desde a primeira mensagem sem resposta', () => {
  const r = run([client('Boa tarde! alguem para consultar?', 0), client('Oi?', 30)]);
  assert.equal(r.status, 'company');
  assert.equal(r.kind, 'question');
  assert.equal(r.since, at(0));
  assert.equal(r.actor, 'Cliente');
});

test('equipe respondeu: sem pendência', () => {
  const r = run([client('Qual o andamento do processo?', 0), team('O processo está concluso para sentença.', 10)]);
  assert.equal(r.status, 'resolved');
  assert.equal(r.kind, 'answered');
});

test('promessa sem entrega continua com a empresa, mesmo com o cliente cobrando, e pega o prazo', () => {
  const r = run([
    client('Preciso da minuta revisada', 0),
    team('Vou verificar e te retorno até sexta', 5),
    client('ok', 6, { opensPending: false }),
    client('E aí, alguma novidade?', 60 * 24),
  ]);
  assert.equal(r.status, 'company');
  assert.equal(r.kind, 'promise');
  assert.match(r.trigger ?? '', /verificar|te retorno/);
  assert.equal(r.actor, 'Julia');
  assert.equal(r.since, at(5));
  assert.ok(r.dueAt, 'prazo "até sexta"');
  assert.equal(new Date(r.dueAt!).getUTCDay(), 5);
});

test('promessa cumprida: entrega com arquivo ou "segue" encerra', () => {
  assert.equal(run([team('Vou ajustar a minuta', 0), team('Segue a minuta corrigida', 120)]).kind, 'delivered');
  assert.equal(run([team('Vou ajustar a minuta', 0), team('', 120, { type: 'document' })]).kind, 'delivered');
});

test('promessa + resposta da equipe + agradecimento do cliente: encerrado', () => {
  const r = run([team('Vou verificar com o cartório', 0), team('O cartório confirmou o registro para amanhã.', 60), client('Obrigado!', 61, { opensPending: false })]);
  assert.equal(r.status, 'resolved');
  assert.equal(r.kind, 'thanked');
});

test('pedido da equipe ao cliente: pendente com o cliente; cliente manda o arquivo: volta para a empresa conferir', () => {
  const asked = run([client('Como faço para dar entrada?', 0), team('Favor enviar RG e comprovante de residência', 5)]);
  assert.equal(asked.status, 'client');
  assert.equal(asked.kind, 'request');
  assert.equal(asked.trigger, 'favor enviar');
  const ok = run([team('Favor enviar RG e comprovante de residência', 5), client('ok, mando hoje', 6, { opensPending: false })]);
  assert.equal(ok.status, 'client', 'um "ok" do cliente não cumpre o pedido');
  const sent = run([team('Favor enviar RG e comprovante de residência', 5), client('', 60, { type: 'image' })]);
  assert.equal(sent.status, 'company');
  assert.equal(sent.kind, 'received');
  const checked = run([team('Favor enviar RG', 5), client('Segue o RG', 60), team('Recebido, obrigado!', 70)]);
  assert.equal(checked.status, 'resolved');
});

test('pergunta da equipe ao cliente é pedido; cortesia não é', () => {
  assert.equal(run([team('O senhor pode assinar hoje ainda?', 0)]).status, 'client');
  assert.equal(run([team('Qual a data do casamento?', 0)]).status, 'client');
  assert.notEqual(run([client('Bom dia', 0), team('Bom dia! Tudo bem?', 1)]).status, 'client');
  assert.notEqual(run([client('Recebi, obrigado', 0), team('Por nada! Algo mais?', 1)]).status, 'client');
});

test('cliente responde ao pedido sem mandar nada: empresa precisa responder', () => {
  const r = run([team('Favor enviar a certidão', 0), client('Não encontrei a certidão, onde peço?', 30)]);
  assert.equal(r.status, 'company');
  assert.equal(r.kind, 'question');
});

test('mensagem de fechamento encerra tudo', () => {
  const r = run([client('Qual o valor?', 0), team('Atendimento encerrado, qualquer coisa estamos à disposição.', 5, { closes: true })]);
  assert.equal(r.kind, 'closed');
});

test('aviso da equipe sem conversa antes: sem pendência; sem mensagens: nada', () => {
  assert.equal(run([team('Bom dia, prezados! Informo que estarei responsável pelo plantão.', 0)]).status, 'resolved');
  assert.equal(run([]).status, null);
});

test('frases de pedido e entrega configuráveis', () => {
  const custom = classifyFollowup([team('Gentileza remeter a procuração', 0)], { ...opts, requestPhrases: ['gentileza remeter'] });
  assert.equal(custom.status, 'client');
  const delivered = classifyFollowup([team('Vou protocolar', 0), team('Distribuído hoje', 30)], { ...opts, deliveryPhrases: ['distribuido'] });
  assert.equal(delivered.kind, 'delivered');
});

test('ordem: mensagens fora de ordem são ordenadas pela data', () => {
  const r = run([team('O processo está concluso.', 10), client('Qual o andamento?', 0)]);
  assert.equal(r.kind, 'answered');
});

test('listas padrão iguais no worker e no painel', async () => {
  const { readFileSync } = await import('node:fs');
  const worker = readFileSync(new URL('./followup-phrases.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/src/lib/followup-phrases.ts', import.meta.url), 'utf8');
  assert.equal(web, worker);
});

test('texto institucional com "caso tenha alguma demanda... retornaremos" não é promessa', () => {
  const institutional =
    '*Vanessa:* Olá! Nosso contato é para reforçar nosso compromisso em auxiliá-lo com qualquer questão jurídica de que precise. ' +
    'Seja na negociação de contratos, acompanhamento de processos judiciais ou resolução de qualquer demanda legal, estamos prontos para atendê-lo.\n\n' +
    'Caso tenha alguma demanda específica, basta nos informar aqui pelo grupo que em breve lhe retornaremos. Ademais com relação a processos judiciais, ' +
    'reforçamos que estamos sempre atentos às intimações e prazos. Sempre que necessário, entraremos em contato.\n\n' +
    'Negociação BANRISUL: Gostaria de verificar e o senhor conseguiu a renegociação do crédito BNDES junto ao Banrisul?\n\nAtenciosamente\nFlores Advogados – Setor Agro.';
  const r = run([team(institutional, 0)]);
  assert.notEqual(r.kind, 'promise');
  // só a frase condicional (sem o texto longo) também não vale
  assert.notEqual(run([team('Caso tenha alguma demanda, em breve lhe retornaremos.', 0)]).kind, 'promise');
  assert.notEqual(run([team('Qualquer dúvida, vou verificar com a equipe.', 0)]).kind, 'promise');
});

test('promessa de verdade continua valendo, também em mensagem com várias frases', () => {
  assert.equal(run([team('Caso tenha dúvida, avise. Vou verificar a minuta e te retorno amanhã.', 0)]).kind, 'promise');
  assert.equal(run([team('Bom dia! Vou verificar o andamento e retorno até sexta.', 0)]).kind, 'promise');
});

test('mensagem institucional da empresa é ignorada por inteiro: não abre pendência nem resolve a que existe', () => {
  const institutional =
    'Vanessa:\nOlá! Nosso contato é para reforçar nosso compromisso em auxiliá-lo com qualquer questão jurídica de que precise. Seja na negociação de contratos, análise de documentos, ' +
    'representação em processos judiciais ou resolução de qualquer demanda legal, estamos prontos para atendê-lo.\n\nCaso tenha alguma demanda específica, basta nos informar aqui pelo grupo que em breve lhe retornaremos. ' +
    'Ademais com relação a processos judiciais, reforçamos que estamos sempre atentos às intimações e prazos, adotando as melhores medidas para garantir a defesa dos seus interesses. ' +
    'Sempre que necessário, entraremos em contato.\n\nAtenciosamente\nFlores Advogados – Setor Agro.';
  assert.equal(run([team(institutional, 0)]).status, null, 'sozinha: nada');
  const open = run([client('Qual o valor da causa?', 0), team(institutional, 5)]);
  assert.equal(open.kind, 'question', 'a pergunta do cliente continua pendente');
  const asked = run([team('Favor enviar o RG', 0), team(institutional, 5)]);
  assert.equal(asked.kind, 'request', 'o pedido da equipe continua pendente');
  // resposta curta de verdade continua valendo
  assert.equal(run([client('Qual o valor da causa?', 0), team('O valor é R$ 10 mil.', 5)]).kind, 'answered');
});

test('equipe entrega a análise (mensagem longa com compromisso) e o cliente agradece depois: encerrado', () => {
  const analysis =
    '*Vanessa:* Analisamos a proposta de adesão ao consórcio da HS Administradora de Consórcios. O documento prevê a contratação de três cotas e a taxa de administração. ' +
    'Quanto à veracidade e à regularidade da empresa, realizamos uma consulta ao CNPJ e verificamos que a empresa está regularmente constituída. Vamos acompanhar eventuais novidades sobre o contrato.';
  const r = run([
    client('Podem analisar a proposta?', 0),
    team(analysis, 10),
    team('Qualquer dúvida, fico à disposição.', 10),
    client('Bom obrigado obrigado por analisar o contrato', 75),
  ]);
  assert.equal(r.status, 'resolved');
  assert.equal(r.kind, 'thanked');
});

test('agradecimento solto depois de promessa curta, sem nada da equipe depois, não encerra', () => {
  const r = run([team('Vou verificar com o cartório e te retorno.', 0), client('Obrigado, aguardo', 5, { opensPending: false })]);
  assert.equal(r.kind, 'promise');
  // cliente que agradece E pede outra coisa continua pendente com a empresa
  const ask = run([team('Segue a minuta.', 0), client('Obrigado! Pode incluir a cláusula de multa?', 5)]);
  assert.equal(ask.status, 'company');
});

test('promessa e pedido na mesma mensagem: vale o último (a bola fica com quem foi pedido por último)', () => {
  const both = team('O nosso prazo é hoje, vou solicitar mais alguns dias de prazo. Quando conseguir alguma informação pode me passar.\nObrigada Roberto!', 0);
  const r = run([both]);
  assert.equal(r.status, 'client');
  assert.equal(r.kind, 'request');
  // o cliente confirma ("Combinado"): continua com o cliente até ele mandar a informação
  assert.equal(run([both, client('Combinado', 6, { opensPending: false })]).status, 'client');
  // quem manda a informação devolve a pendência para a empresa conferir
  assert.equal(run([both, client('Combinado', 6, { opensPending: false }), client('Segue o relatório', 300)]).status, 'company');
  // ordem inversa: pede primeiro e promete por último = promessa da equipe
  assert.equal(run([team('Pode nos enviar o contrato? Vou analisar assim que chegar e te retorno.', 0)]).kind, 'promise');
});

test('encerramento/repasse do assunto pela equipe: sem pendência, mesmo com promessa antes na mensagem', () => {
  const handoff =
    'Entendido sr. Leonardo. Dessa forma, acabamos de substabelecer o processo para a nova procuradora para que ela possa dar andamento.\n\n' +
    'Ressaltamos que o prazo recursal encerra na data de hoje; vamos acompanhar a publicação e avisar a procuradora. Contudo, agora cabe a nova procuradora decidir.\n\n' +
    'Esse grupo, por fim, será encerrado tendo em vista que era para esse processo, sem demanda em específico.\n\nFicamos à disposição!';
  const r = run([client('Pode substabelecer para outro escritório?', 0), team(handoff, 10)]);
  assert.equal(r.status, 'resolved');
  assert.equal(r.kind, 'closed');
  assert.equal(run([team('Vou verificar. O atendimento está encerrado.', 0)]).kind, 'closed');
  // promessa DEPOIS do aviso de encerramento continua valendo
  assert.equal(run([team('O atendimento foi encerrado. Vou enviar a certidão amanhã.', 0)]).kind, 'promise');
});

test('comunicado da equipe ao grupo (aviso geral) é ignorado por inteiro', () => {
  const notice =
    'Prezados(as), bom dia!\nÉ a Sabrina Schutz.\n\nGostaríamos de informar que os índices do Fator Acidentário de Prevenção (FAP), com vigência para o ano de 2027, já foram divulgados e estão disponíveis para consulta!\n\n' +
    'O Fator Acidentário de Prevenção (FAP) é um multiplicador aplicado às alíquotas de contribuição destinadas ao financiamento dos benefícios decorrentes de acidentes de trabalho. ' +
    'Seu índice varia de 0,5000 a 2,0000. Vamos acompanhar o prazo de contestação e iremos avisar cada empresa.';
  assert.equal(run([team(notice, 0)]).status, null);
  assert.equal(run([client('Qual o valor do FAP?', 0), team(notice, 5)]).kind, 'question', 'não resolve a pergunta do cliente');
  // resposta curta e específica começando com "Prezados" continua valendo como promessa
  assert.equal(run([team('Prezados, bom dia! Vou verificar o FAP da empresa e te retorno amanhã.', 0)]).kind, 'promise');
});

test('promessa de análise e, depois, resposta longa da equipe com a análise: cumprida', () => {
  const analysis =
    '@Eduardo Contel Financeiro, conforme falamos em ligação, do ponto de vista jurídico, não estou de acordo com a inclusão da cláusula sugerida pela MVNO no contrato padrão. ' +
    'A redação proposta é excessivamente abrangente e vaga, pois estabelece que todas as ofertas, propostas, negociações e compromissos anteriores à assinatura, desde que documentados por qualquer meio, permaneceriam válidos e vinculantes.';
  const r = run([
    team('Vou fazer a análise das demais questões pendentes e retorno a vocês.', 0),
    client('Sobre contrato da VNTFMAIS: segue contrato, valores pendentes e total de linhas ativas', 40),
    client('', 41, { type: 'document' }),
    team(analysis, 100),
  ]);
  assert.equal(r.status, 'resolved');
  assert.equal(r.kind, 'answered');
  // resposta curta depois da promessa continua sem cumprir
  assert.equal(run([team('Vou fazer a análise e retorno a vocês.', 0), team('Ok, estamos vendo.', 10)]).kind, 'promise');
  // resposta longa que traz uma nova promessa no fim continua pendente
  assert.equal(run([team('Vou fazer a análise e retorno.', 0), team(analysis + ' Sobre o prazo, vou verificar com o cliente e te retorno amanhã.', 100)]).kind, 'promise');
});
