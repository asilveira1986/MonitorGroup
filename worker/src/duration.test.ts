import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatWait, formatWaitSeconds } from './duration.js';

test('formatWait: minutos até 59, depois horas e minutos com dois dígitos', () => {
  assert.equal(formatWait(0), '0 min');
  assert.equal(formatWait(14), '14 min');
  assert.equal(formatWait(14.9), '14 min');
  assert.equal(formatWait(59), '59 min');
  assert.equal(formatWait(60), '1h00');
  assert.equal(formatWait(65), '1h05');
  assert.equal(formatWait(690), '11h30');
  assert.equal(formatWait(-5), '0 min');
});

test('formatWaitSeconds: o mesmo texto a partir de segundos', () => {
  assert.equal(formatWaitSeconds(0), '0 min');
  assert.equal(formatWaitSeconds(59), '0 min');
  assert.equal(formatWaitSeconds(900), '15 min');
  assert.equal(formatWaitSeconds(4500), '1h15');
});
