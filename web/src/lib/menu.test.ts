import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSeeMenu, MENU_ITEMS } from './menu.ts';

test('Grupos (lista e monitoramento) é só de administradores, em qualquer configuração', () => {
  for (const config of [null, {}, { '/groups': 'all' }, { '/groups': 'admin' }]) {
    assert.equal(canSeeMenu(config, '/groups', true), true, 'administrador vê');
    assert.equal(canSeeMenu(config, '/groups', false), false, 'atendente não vê');
    assert.equal(canSeeMenu(config, '/groups', false, true), false, 'só-visualizar não vê');
  }
  // a empresa ainda pode ocultar para todos, inclusive administradores
  assert.equal(canSeeMenu({ '/groups': 'none' }, '/groups', true), false);
});

test('os outros menus continuam como antes', () => {
  for (const href of ['/dashboard', '/panel', '/pending', '/alerts']) {
    assert.equal(canSeeMenu(null, href, false), true, href + ' para atendente');
  }
  assert.equal(canSeeMenu({ '/alerts': 'admin' }, '/alerts', false), false);
  assert.equal(canSeeMenu({ '/alerts': 'admin' }, '/alerts', true), true);
  assert.equal(canSeeMenu({ '/settings': 'none' }, '/settings', true), true, 'Configurações nunca some para administrador');
  assert.ok(MENU_ITEMS.some((i) => i.href === '/groups' && 'adminOnly' in i));
});
