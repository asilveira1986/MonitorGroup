import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
const { pushOutcome } = await import('./push.js');

test('resultado do envio push', () => {
  assert.equal(pushOutcome(201), 'ok');
  assert.equal(pushOutcome(410), 'gone');
  assert.equal(pushOutcome(404), 'gone');
  assert.equal(pushOutcome(429), 'failed');
  assert.equal(pushOutcome(undefined), 'failed');
});
