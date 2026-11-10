import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durationLabel, durationMinutes, endFor, endIsAfterStart, eventMinutes, fromMinutes, rangeLabel, shiftEnd, toMinutes } from './agenda-time.ts';

test('conversões de horário', () => {
  assert.equal(toMinutes('09:30'), 570);
  assert.equal(toMinutes('24:00'), null);
  assert.equal(toMinutes('9:30'), null);
  assert.equal(fromMinutes(570), '09:30');
  assert.equal(fromMinutes(2000), '23:59', 'limitado ao mesmo dia');
});

test('término depois do início', () => {
  assert.equal(endIsAfterStart('09:00', ''), true, 'sem término vale');
  assert.equal(endIsAfterStart('09:00', '10:00'), true);
  assert.equal(endIsAfterStart('09:00', '09:00'), false);
  assert.equal(endIsAfterStart('09:00', '08:30'), false);
});

test('mudar o início leva o término junto, mantendo a duração', () => {
  assert.equal(shiftEnd('09:00', '10:00', '09:30'), '10:30');
  assert.equal(shiftEnd('09:00', '08:00', '10:00'), '09:00');
  assert.equal(shiftEnd('09:00', '10:00', ''), '', 'sem término continua sem');
  assert.equal(shiftEnd('09:00', '23:30', '10:00'), '23:59', 'não passa da meia-noite');
});

test('durações prontas e rótulos', () => {
  assert.equal(endFor('14:00', 90), '15:30');
  assert.equal(endFor('23:00', 120), '', 'passaria da meia-noite');
  assert.equal(durationMinutes('14:00', '15:30'), 90);
  assert.equal(durationMinutes('14:00', '13:00'), null);
  assert.equal(durationLabel(45), '45 min');
  assert.equal(durationLabel(60), '1 h');
  assert.equal(durationLabel(90), '1 h 30 min');
});

test('texto do horário do compromisso e duração', () => {
  const tz = 'America/Sao_Paulo';
  assert.equal(rangeLabel('2026-11-10T17:00:00Z', '2026-11-10T18:30:00Z', false, tz), '14:00–15:30');
  assert.equal(rangeLabel('2026-11-10T17:00:00Z', null, false, tz), '14:00');
  assert.equal(rangeLabel('2026-11-10T17:00:00Z', '2026-11-10T18:30:00Z', true, tz), 'dia todo');
  assert.equal(eventMinutes('2026-11-10T17:00:00Z', '2026-11-10T18:30:00Z', false), 90);
  assert.equal(eventMinutes('2026-11-10T17:00:00Z', null, false), null);
  assert.equal(eventMinutes('2026-11-10T17:00:00Z', '2026-11-10T18:30:00Z', true), null);
});
