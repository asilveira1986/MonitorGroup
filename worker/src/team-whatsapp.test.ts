import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
const { withLink } = await import('./team-whatsapp.js');

test('withLink troca {link} pelo endereço do painel', () => {
  assert.equal(withLink('Oi\n{link}', '/agenda?evento=1', 'https://painel.app'), 'Oi\nhttps://painel.app/agenda?evento=1');
  assert.equal(withLink('Oi\n\n{link}', '/agenda', ''), 'Oi');
  assert.equal(withLink('Sem link', null, 'https://painel.app'), 'Sem link');
});
