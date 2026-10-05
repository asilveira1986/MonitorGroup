import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseProfile, isPaired } from './connection-profile.js';

test('sessão lida no QR code conta como pareada (me preenchido, registered falso)', () => {
  assert.equal(isPaired({ me: { id: '5511999999999:3@s.whatsapp.net' }, registered: false }), true);
  assert.equal(isPaired({ me: undefined, registered: false }), false);
  assert.equal(isPaired({ me: undefined, registered: true }), true);
});

test('sessão pareada mantém o perfil do pareamento, mesmo após falhas', () => {
  for (const failedAttempts of [0, 1, 2, 3]) {
    assert.equal(chooseProfile({ paired: true, savedProfile: 'desktop', wantsHistory: true, failedAttempts }), 'desktop');
    assert.equal(chooseProfile({ paired: true, savedProfile: 'chrome', wantsHistory: true, failedAttempts }), 'chrome');
  }
});

test('sessão pareada antiga (sem perfil salvo) usa o perfil preferido', () => {
  assert.equal(chooseProfile({ paired: true, savedProfile: undefined, wantsHistory: true, failedAttempts: 1 }), 'desktop');
  assert.equal(chooseProfile({ paired: true, savedProfile: undefined, wantsHistory: false, failedAttempts: 0 }), 'chrome');
});

test('pareamento novo alterna Desktop e Chrome a cada falha', () => {
  const seq = [0, 1, 2, 3].map((failedAttempts) =>
    chooseProfile({ paired: false, savedProfile: undefined, wantsHistory: true, failedAttempts }),
  );
  assert.deepEqual(seq, ['desktop', 'chrome', 'desktop', 'chrome']);
  assert.equal(chooseProfile({ paired: false, savedProfile: undefined, wantsHistory: false, failedAttempts: 0 }), 'chrome');
});
