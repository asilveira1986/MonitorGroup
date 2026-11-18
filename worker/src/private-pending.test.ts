import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opensPendingPrivate } from './private-pending.js';

const on = { ignore_acknowledgements: true, ignore_phrases: [] as string[] };

test('conversa privada: o que não pede resposta da equipe', () => {
  assert.equal(opensPendingPrivate('text', 'bom dia', on), false);
  assert.equal(opensPendingPrivate('text', 'vou verificar', on), false);
  assert.equal(opensPendingPrivate('text', 'Obrigado!', on), false);
  assert.equal(opensPendingPrivate('sticker', null, on), false);
  assert.equal(opensPendingPrivate('text', '👍', on), false);
});

test('conversa privada: pergunta e pedido continuam pedindo resposta; a opção desligada vale para tudo', () => {
  assert.equal(opensPendingPrivate('text', 'Bom dia, tem novidades do processo?', on), true);
  assert.equal(opensPendingPrivate('text', 'Preciso do contrato', on), true);
  assert.equal(opensPendingPrivate('text', 'vou verificar, mas preciso do contrato', on), true);
  assert.equal(opensPendingPrivate('text', 'bom dia', { ignore_acknowledgements: false }), true);
});
