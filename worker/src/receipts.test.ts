import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selfReadIds } from './receipts.js';

test('leitura do próprio celular num grupo devolve os ids', () => {
  const node = {
    tag: 'receipt',
    attrs: { from: '123-456@g.us', id: 'A1', type: 'read-self', participant: '5511@s.whatsapp.net', t: '1700000000' },
    content: [{ tag: 'list', attrs: {}, content: [{ tag: 'item', attrs: { id: 'A2' } }, { tag: 'item', attrs: { id: 'A3' } }] }],
  };
  assert.deepEqual(selfReadIds(node), ['A1', 'A2', 'A3']);
});

test('ignora entrega, leitura de terceiros e conversas individuais', () => {
  assert.equal(selfReadIds({ tag: 'receipt', attrs: { from: '123@g.us', id: 'A', participant: 'x' } }), null);
  assert.equal(selfReadIds({ tag: 'receipt', attrs: { from: '123@g.us', id: 'A', type: 'read', participant: 'x' } }), null);
  assert.equal(selfReadIds({ tag: 'receipt', attrs: { from: '5511@s.whatsapp.net', id: 'A', type: 'read-self' } }), null);
});
