import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAccessScreen, defaultScreenAccess, EDITABLE_SCREENS, hiddenScreens, parseScreenAccess, SCREENS, screenAccessOverrides } from './screens.ts';

const admin = { role: 'admin' as const, platformAdmin: false };
const agent = { role: 'agent' as const, platformAdmin: false };
const viewer = { role: 'viewer' as const, platformAdmin: false };
const agenda = { role: 'agenda' as const, platformAdmin: false };
const platform = { role: 'admin' as const, platformAdmin: true };

test('sem escolha pessoal, vale o padrão do perfil (o mesmo de antes)', () => {
  assert.equal(canAccessScreen('/alerts', agent, {}), true);
  assert.equal(canAccessScreen('/groups', agent, {}), false, 'Grupos é só de administradores');
  assert.equal(canAccessScreen('/groups', admin, {}), true);
  // só ver painéis: só Dashboard e Painel de grupos
  assert.equal(canAccessScreen('/dashboard', viewer, {}), true);
  assert.equal(canAccessScreen('/alerts', viewer, {}), false);
  // só agenda: só a Agenda
  assert.equal(canAccessScreen('/agenda', agenda, {}), true);
  assert.equal(canAccessScreen('/panel', agenda, {}), false);
  // menu oculto pela empresa
  assert.equal(canAccessScreen('/reports', agent, { '/reports': 'none' }), false);
  assert.equal(canAccessScreen('/reports', agent, { '/reports': 'admin' }), false);
  assert.equal(canAccessScreen('/reports', admin, { '/reports': 'admin' }), true);
});

test('telas fora de Configurações › Menus (privadas, contatos) não passam a ser restritas pelo perfil', () => {
  for (const who of [admin, agent, viewer, agenda]) {
    assert.equal(defaultScreenAccess({}, '/private', who), true);
    assert.equal(defaultScreenAccess({}, '/contacts', who), true);
  }
});

test('a escolha pessoal vale sobre o padrão, para liberar e para bloquear', () => {
  assert.equal(canAccessScreen('/alerts', { ...agent, screenAccess: { '/alerts': false } }, {}), false);
  assert.equal(canAccessScreen('/alerts', { ...viewer, screenAccess: { '/alerts': true } }, {}), true);
  assert.equal(canAccessScreen('/panel', { ...agenda, screenAccess: { '/panel': true } }, {}), true);
  // vale também sobre o menu oculto pela empresa (a escolha é para esta pessoa)
  assert.equal(canAccessScreen('/reports', { ...agent, screenAccess: { '/reports': true } }, { '/reports': 'none' }), true);
  // o que não foi escolhido continua no padrão
  assert.equal(canAccessScreen('/demands', { ...agent, screenAccess: { '/alerts': false } }, {}), true);
});

test('telas fixas não se configuram por pessoa', () => {
  // só administradores: a escolha não libera para um atendente
  assert.equal(canAccessScreen('/groups', { ...agent, screenAccess: { '/groups': true } }, {}), false);
  assert.equal(canAccessScreen('/acompanhamento', { ...agent, screenAccess: { '/acompanhamento': true } }, {}), false);
  // nem bloqueia um administrador
  assert.equal(canAccessScreen('/groups', { ...admin, screenAccess: { '/groups': false } }, {}), true);
  // só da plataforma
  for (const href of ['/platform', '/logs', '/notificacoes', '/broadcasts', '/private-panel']) {
    assert.equal(canAccessScreen(href, { ...admin, screenAccess: { [href]: true } }, {}), false, href);
    assert.equal(canAccessScreen(href, platform, {}), true, href);
  }
});

test('Configurações nunca some para administrador, mesmo bloqueada', () => {
  assert.equal(canAccessScreen('/settings', { ...admin, screenAccess: { '/settings': false } }, { '/settings': 'none' }), true);
  assert.equal(canAccessScreen('/settings', { ...agent, screenAccess: { '/settings': false } }, {}), false);
});

test('parseScreenAccess: só entradas booleanas de telas configuráveis', () => {
  assert.deepEqual(parseScreenAccess({ '/alerts': false, '/panel': true, '/groups': true, '/inexistente': true, '/reports': 'sim' }), { '/alerts': false, '/panel': true });
  assert.deepEqual(parseScreenAccess(null), {});
  assert.deepEqual(parseScreenAccess([true]), {});
  assert.deepEqual(parseScreenAccess('x'), {});
});

test('screenAccessOverrides: guarda só o que difere do padrão da pessoa; tudo igual volta ao padrão', () => {
  // atendente: padrão vê tudo que não é fixo
  const all = Object.fromEntries(EDITABLE_SCREENS.map((s) => [s.href, true]));
  assert.equal(screenAccessOverrides(all, agent, {}), null);
  assert.deepEqual(screenAccessOverrides({ ...all, '/alerts': false }, agent, {}), { '/alerts': false });
  // só ver painéis: marcar Relatórios libera só ele
  const none = Object.fromEntries(EDITABLE_SCREENS.map((s) => [s.href, false]));
  // (conversas privadas e contatos seguem as próprias regras: o padrão é liberado, então ficam marcadas)
  assert.deepEqual(screenAccessOverrides({ ...none, '/dashboard': true, '/panel': true, '/private': true, '/contacts': true, '/reports': true }, viewer, {}), { '/reports': true });
  // desmarcar uma dessas é um bloqueio pessoal
  assert.deepEqual(screenAccessOverrides({ ...none, '/dashboard': true, '/panel': true, '/private': false, '/contacts': true }, viewer, {}), { '/private': false });
  // tela desconhecida ou valor que não é booleano é ignorado
  assert.equal(screenAccessOverrides({ '/inexistente': true, '/alerts': 'x' as unknown as boolean }, agent, {}), null);
});

test('hiddenScreens: as telas que somem do menu para a pessoa', () => {
  const hidden = hiddenScreens({ ...agent, screenAccess: { '/alerts': false } }, {});
  assert.ok(hidden.includes('/alerts'));
  assert.ok(hidden.includes('/groups'), 'Grupos é só de administradores');
  assert.ok(hidden.includes('/platform'));
  assert.ok(!hidden.includes('/demands'));
  // administrador da plataforma vê todas
  assert.deepEqual(hiddenScreens(platform, {}), []);
});

test('toda tela do menu lateral está na lista de telas', () => {
  const hrefs = SCREENS.map((s) => s.href);
  assert.equal(new Set(hrefs).size, hrefs.length, 'sem repetição');
  for (const href of ['/dashboard', '/agenda', '/panel', '/groups', '/pending', '/demands', '/private', '/contacts', '/reports', '/alerts', '/settings']) {
    assert.ok(hrefs.includes(href), href);
  }
});
