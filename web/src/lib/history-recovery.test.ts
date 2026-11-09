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

import { batchOpen, batchProgress, parseBatchStatus } from './history-recovery.ts';

test('lote: progresso e se ainda há grupos em andamento', () => {
  assert.deepEqual(batchProgress({ total: 487, pending: 400, running: 1 }), { finished: 86, percent: 18 });
  assert.deepEqual(batchProgress({ total: 10, pending: 0, running: 0 }), { finished: 10, percent: 100 });
  assert.deepEqual(batchProgress({ total: 0, pending: 0, running: 0 }), { finished: 0, percent: 0 });
  assert.equal(batchOpen({ pending: 1, running: 0 }), true);
  assert.equal(batchOpen({ pending: 0, running: 1 }), true);
  assert.equal(batchOpen({ pending: 0, running: 0 }), false);
});

test('lote: lê o andamento do banco e ignora o que não é um lote', () => {
  assert.equal(parseBatchStatus(null), null);
  assert.equal(parseBatchStatus('x'), null);
  assert.equal(parseBatchStatus({ total: 3 }), null);
  const b = parseBatchStatus({
    batch_id: 'b1', days: 7, created_at: '2026-11-09T12:00:00Z', total: 4, pending: 1, running: 1, done: 1, failed: 1, cancelled: 0,
    added: '10', found: 20, groups_with_news: 1, failed_notes: [{ note: 'O celular não respondeu.', n: 1 }, { note: null, n: 2 }],
  });
  assert.equal(b!.batchId, 'b1');
  assert.equal(b!.added, 10); // número vindo como texto
  assert.equal(b!.groupsWithNews, 1);
  assert.deepEqual(b!.failedNotes, [{ note: 'O celular não respondeu.', n: 1 }, { note: null, n: 2 }]);
});
