import assert from 'node:assert/strict';
import test from 'node:test';
import { ackErrorCode, ERROR_STATUS, MAX_SEND_RETRIES, retryDelayMs, shouldRetrySend } from './delivery.ts';

test('o código de erro vem do primeiro parâmetro do aviso', () => {
  assert.equal(ackErrorCode({ messageStubParameters: ['479'] }), '479');
  assert.equal(ackErrorCode({ messageStubParameters: [463, 'texto'] }), '463');
  assert.equal(ackErrorCode({ messageStubParameters: [] }), null);
  assert.equal(ackErrorCode({}), null);
  assert.equal(ackErrorCode({ messageStubParameters: 'x' }), null);
});

test('reenvia até o limite, e nunca nas recusas em que o reenvio não adianta', () => {
  assert.equal(ERROR_STATUS, 0);
  for (let attempts = 0; attempts < MAX_SEND_RETRIES; attempts++) assert.equal(shouldRetrySend('479', attempts), true);
  assert.equal(shouldRetrySend('479', MAX_SEND_RETRIES), false);
  // sem código também reenvia (não se sabe o motivo)
  assert.equal(shouldRetrySend(null, 0), true);
  // conta com restrição e erros de formato: não reenvia
  for (const code of ['463', '487', '491', '495']) assert.equal(shouldRetrySend(code, 0), false, code);
});

test('a espera cresce a cada tentativa', () => {
  assert.ok(retryDelayMs(2) > retryDelayMs(1));
  assert.ok(retryDelayMs(0) > 0);
});
