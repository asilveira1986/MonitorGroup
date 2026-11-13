import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signatureKey, signedName } from './signature.js';

test('assinatura "*Nome:*" na primeira linha', () => {
  assert.equal(signedName('*Nicholas Matos:*\nBom dia pessoal!'), 'Nicholas Matos');
  assert.equal(signedName('*Alexsandro:*\n\ntexto'), 'Alexsandro');
  // sem assinatura, ou o texto só começa com negrito
  assert.equal(signedName('Bom dia pessoal!'), null);
  assert.equal(signedName('*Atenção* o prazo vence'), null);
  assert.equal(signedName('*Nicholas Matos:* texto na mesma linha'), null);
  assert.equal(signedName(null), null);
});

test('nomes comparados sem acento, maiúsculas e espaços repetidos', () => {
  assert.equal(signatureKey('  José   da Silva '), signatureKey('JOSE DA SILVA'));
  assert.equal(signatureKey(null), '');
});
