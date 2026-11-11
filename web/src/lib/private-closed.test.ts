import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOSED_DEFAULT_DAYS, CLOSED_PERIODS, closedSince } from './private-closed.ts';

test('finalizadas: padrão de 90 dias e começo do período', () => {
  assert.equal(CLOSED_DEFAULT_DAYS, 90);
  assert.ok(CLOSED_PERIODS.some((p) => p.days === CLOSED_DEFAULT_DAYS));
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(closedSince(90, now), '2026-08-13T12:00:00.000Z');
  assert.equal(closedSince(0, now), '', '0 = todo o período');
});
