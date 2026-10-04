import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePromise } from './dates.js';

const tz = 'America/Sao_Paulo';
const opts = { timeZone: tz, businessEnd: '18:00' };
// quinta-feira, 01/10/2026 10:00 em São Paulo
const now = new Date('2026-10-01T13:00:00Z');
const local = (d: Date | null) =>
  d && new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d);

test('prazos relativos ao dia', () => {
  assert.equal(local(parsePromise('Entrego até hoje', now, opts)), '01/10/2026, 18:00');
  assert.equal(local(parsePromise('fica pronto até amanhã', now, opts)), '02/10/2026, 18:00');
  assert.equal(local(parsePromise('até amanhã às 10h', now, opts)), '02/10/2026, 10:00');
  assert.equal(local(parsePromise('até o fim do dia', now, opts)), '01/10/2026, 18:00');
});

test('dia da semana e data', () => {
  assert.equal(local(parsePromise('Consigo até sexta-feira', now, opts)), '02/10/2026, 18:00');
  assert.equal(local(parsePromise('até segunda', now, opts)), '05/10/2026, 18:00');
  assert.equal(local(parsePromise('até quinta', now, opts)), '01/10/2026, 18:00');
  assert.equal(local(parsePromise('Envio até 15/10 às 14:30', now, opts)), '15/10/2026, 14:30');
  assert.equal(local(parsePromise('até o dia 05/01', now, opts)), '05/01/2027, 18:00');
});

test('prazos em quantidade', () => {
  assert.equal(local(parsePromise('resolvo em 2 horas', now, opts)), '01/10/2026, 12:00');
  assert.equal(local(parsePromise('em 3 dias', now, opts)), '04/10/2026, 18:00');
  assert.equal(local(parsePromise('em 2 dias úteis', now, opts)), '05/10/2026, 18:00');
});

test('frases sem prazo', () => {
  assert.equal(parsePromise('até mais!', now, opts), null);
  assert.equal(parsePromise('obrigado, até logo', now, opts), null);
  assert.equal(parsePromise('a reunião foi dia 10/09', now, opts), null);
  assert.equal(parsePromise(null, now, opts), null);
});
