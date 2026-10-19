import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingChunks, isClosingMessage } from './closing.js';

const TEMPLATE =
  '{saudacao}, {cliente}! Estamos encerrando este atendimento. Qualquer dúvida, é só chamar por aqui. {atendente}';

test('reconhece o fechamento com os itens trocados e assinatura do painel', () => {
  assert.ok(isClosingMessage('Boa tarde, Carla! Estamos encerrando este atendimento. Qualquer dúvida, é só chamar por aqui. Ana', TEMPLATE));
  assert.ok(isClosingMessage('*Ana Souza:*\nBom dia! Estamos encerrando este atendimento. Qualquer duvida e so chamar por aqui', TEMPLATE));
});

test('não confunde com mensagens parecidas', () => {
  assert.ok(!isClosingMessage('Estamos encerrando este atendimento?', TEMPLATE));
  assert.ok(!isClosingMessage('Qualquer dúvida, é só chamar por aqui. Estamos encerrando este atendimento.', TEMPLATE));
  assert.ok(!isClosingMessage('Bom dia', '{saudacao}, {cliente}!'));
  assert.deepEqual(closingChunks('{saudacao}!'), []);
  assert.ok(!isClosingMessage('qualquer coisa', null));
});
