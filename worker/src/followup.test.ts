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
