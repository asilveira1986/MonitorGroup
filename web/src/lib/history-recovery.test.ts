import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_OPTIONS, DEFAULT_DAYS, isOpen, STATUS_LABEL, summary, validDays } from './history-recovery.ts';

test('recuperação: períodos oferecidos são válidos e o padrão está entre eles', () => {
  for (const d of DAY_OPTIONS) assert.equal(validDays(d), true, String(d));
  assert.ok((DAY_OPTIONS as readonly number[]).includes(DEFAULT_DAYS));
  for (const ruim of [0, 31, -1, 1.5, '7', null, undefined, NaN]) assert.equal(validDays(ruim), false, String(ruim));
});

test('recuperação: só na fila ou rodando conta como em andamento', () => {
  assert.equal(isOpen('pending'), true);
  assert.equal(isOpen('running'), true);
  for (const s of ['done', 'failed', 'cancelled', 'x']) assert.equal(isOpen(s), false, s);
  assert.ok(STATUS_LABEL.running && STATUS_LABEL.done && STATUS_LABEL.failed && STATUS_LABEL.cancelled && STATUS_LABEL.pending);
});

test('recuperação: resumo no singular e no plural', () => {
  assert.equal(summary({ added: 1, found: 1, requests: 1 }), '1 mensagem nova · 1 vista · 1 pedido');
  assert.equal(summary({ added: 0, found: 120, requests: 4 }), '0 mensagens novas · 120 vistas · 4 pedidos');
});
