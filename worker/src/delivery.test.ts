import assert from 'node:assert/strict';
import test from 'node:test';
import { ackErrorCode, ERROR_STATUS, MAX_SEND_RETRIES, privateFailureAlert, retryDelayMs, shouldRetrySend } from './delivery.ts';

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

test('alerta de mensagem não entregue: texto e destinatários sem repetir', () => {
  const a = privateFailureAlert({ contactName: 'Plínio Brasil', phone: '555192702660', body: 'Boa tarde!', messageType: 'text', code: '479', retries: 2, sender: 'u1', responsible: 'u1' });
  assert.equal(a.title, 'Mensagem não entregue a Plínio Brasil');
  assert.match(a.description, /"Boa tarde!" não chegou ao cliente/);
  assert.match(a.description, /2 reenvios automáticos/);
  assert.match(a.description, /código 479/);
  assert.deepEqual(a.userIds, ['u1']);
  // quem escreveu e o responsável, quando são pessoas diferentes
  assert.deepEqual(privateFailureAlert({ contactName: null, phone: '555192702660', body: null, messageType: 'image', code: null, retries: 0, sender: 'u1', responsible: 'u2' }).userIds, ['u1', 'u2']);
  // sem ninguém: lista vazia (nunca "todos")
  assert.deepEqual(privateFailureAlert({ contactName: null, phone: null, body: 'x', messageType: 'text', code: null, retries: 1, sender: null, responsible: null }).userIds, []);
  // sem nome usa o telefone; sem texto usa o tipo; sem tentativas não cita reenvio
  const b = privateFailureAlert({ contactName: null, phone: '555192702660', body: null, messageType: 'image', code: null, retries: 0, sender: null, responsible: null });
  assert.equal(b.title, 'Mensagem não entregue a +555192702660');
  assert.match(b.description, /^Imagem não chegou/);
  assert.doesNotMatch(b.description, /reenvio/);
  // texto longo é cortado
  assert.ok(privateFailureAlert({ contactName: 'A', phone: null, body: 'x'.repeat(300), messageType: 'text', code: null, retries: 0, sender: null, responsible: null }).description.length < 260);
});
