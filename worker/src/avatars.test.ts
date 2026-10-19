import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
const { avatarPath } = await import('./avatars.js');

test('caminho da foto: por empresa, estável e sem o jid exposto', () => {
  const a = avatarPath('emp-1', '5511999998888@s.whatsapp.net');
  assert.equal(a, avatarPath('emp-1', '5511999998888@s.whatsapp.net'));
  assert.notEqual(a, avatarPath('emp-1', '5511999997777@s.whatsapp.net'));
  assert.match(a, /^emp-1\/avatars\/[0-9a-f]{20}\.jpg$/);
  assert.ok(!a.includes('5511'));
  assert.equal(avatarPath('emp-1', '5511999998888@s.whatsapp.net', true), a.replace(/\.jpg$/, '.full.jpg'));
});
