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

test('datas: somar dias, diferença e intervalo', async () => {
  const { addDaysYmd, diffDays, ymdRange } = await import('./agenda-time.ts');
  assert.equal(addDaysYmd('2026-11-30', 1), '2026-12-01');
  assert.equal(addDaysYmd('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-10', '2026-11-13'), 3);
  assert.equal(diffDays('2026-11-13', '2026-11-10'), -3);
  assert.deepEqual(ymdRange('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(ymdRange('2026-11-10', '2026-11-10'), ['2026-11-10']);
});

test('em que dias o compromisso aparece (fuso de Brasília)', async () => {
  const { eventDays, isMultiDay } = await import('./agenda-time.ts');
  const tz = 'America/Sao_Paulo';
  // 22:00 do dia 12 (01:00Z do 13) até 09:30 do dia 13 (12:30Z)
  assert.deepEqual(eventDays('2026-11-13T01:00:00Z', '2026-11-13T12:30:00Z', tz), ['2026-11-12', '2026-11-13']);
  assert.equal(isMultiDay('2026-11-13T01:00:00Z', '2026-11-13T12:30:00Z', tz), true);
  // sem término ou no mesmo dia: um dia só
  assert.deepEqual(eventDays('2026-11-12T17:00:00Z', null, tz), ['2026-11-12']);
  assert.deepEqual(eventDays('2026-11-12T17:00:00Z', '2026-11-12T18:00:00Z', tz), ['2026-11-12']);
  // termina exatamente à meia-noite: não conta o dia seguinte
  assert.deepEqual(eventDays('2026-11-13T01:00:00Z', '2026-11-13T03:00:00Z', tz), ['2026-11-12']);
  // dia todo de 12 a 15 (meio-dia)
  assert.deepEqual(eventDays('2026-11-12T15:00:00Z', '2026-11-15T15:00:00Z', tz), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
});

test('textos: duração em dias e "quando"', async () => {
  const { spanLabel, whenLabel, endAfterStart } = await import('./agenda-time.ts');
  const tz = 'America/Sao_Paulo';
  assert.equal(spanLabel(90), '1 h 30 min');
  assert.equal(spanLabel(1440), '1 dia');
  assert.equal(spanLabel(2 * 1440 + 180), '2 dias 3 h');
  assert.equal(whenLabel('2026-11-13T01:00:00Z', '2026-11-13T12:30:00Z', false, tz), '22:00 → 13/11 09:30');
  assert.equal(whenLabel('2026-11-12T15:00:00Z', '2026-11-15T15:00:00Z', true, tz), 'dia todo · 12/11 a 15/11');
  assert.equal(whenLabel('2026-11-12T15:00:00Z', null, true, tz), 'dia todo');
  assert.equal(whenLabel('2026-11-12T17:00:00Z', '2026-11-12T18:30:00Z', false, tz), '14:00–15:30');
  // validação com datas separadas
  assert.equal(endAfterStart('2026-11-12', '22:00', '2026-11-13', '09:00'), true);
  assert.equal(endAfterStart('2026-11-12', '22:00', '2026-11-12', '09:00'), false);
  assert.equal(endAfterStart('2026-11-12', '22:00', '2026-11-11', '23:00'), false);
  assert.equal(endAfterStart('2026-11-12', '22:00', '', ''), true);
});
