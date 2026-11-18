import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOnline, mutedKinds, notificationState } from './notification-status.ts';

test('estado das notificações', () => {
  assert.equal(notificationState({ alerts_off: true, devices: 2, devices_ok: 2 }), 'off');
  assert.equal(notificationState({ alerts_off: false, devices: 1, devices_ok: 1 }), 'ok');
  assert.equal(notificationState({ alerts_off: false, devices: 2, devices_ok: 0 }), 'failing');
  assert.equal(notificationState({ alerts_off: false, devices: 0, devices_ok: 0 }), 'screen');
});

test('tipos de push desligados e online', () => {
  assert.deepEqual(mutedKinds({ agenda: false, private: true, alert: false }), ['Agenda', 'Alertas dos grupos']);
  assert.deepEqual(mutedKinds({}), []);
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(isOnline('2026-11-18T11:57:00Z', now), true);
  assert.equal(isOnline('2026-11-18T11:50:00Z', now), false);
  assert.equal(isOnline(null, now), false);
});
