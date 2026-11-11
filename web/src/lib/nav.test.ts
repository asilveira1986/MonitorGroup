import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeGroupId, badgeKind, badgeText, groupBadge, isActive, isGroupOpen, NAV_TREE, parseGroupPrefs, visibleNav, type NavGroup } from './nav.ts';

const names = (tree: ReturnType<typeof visibleNav>) => tree.map((e) => (e.kind === 'item' ? e.label : `${e.label}: ${e.items.map((i) => i.label).join(', ')}`));
const group = (id: string): NavGroup => {
  const g = NAV_TREE.find((e) => e.kind === 'group' && e.id === id);
  assert.ok(g && g.kind === 'group');
  return g;
};

test('estrutura pedida: Dashboard, grupos e itens soltos nas posições certas', () => {
  const all = visibleNav(NAV_TREE, { hidden: [], platformAdmin: true });
  assert.deepEqual(names(all), [
    'Dashboard',
    'Agenda',
    'Grupos: Painel de grupos, Grupos, Aguardando resposta, Demandas',
    'Conversas: Conversas privadas, Contatos',
    'Automações: Disparos',
    'Gestão: Empresas, Relatórios, Alertas, Acompanhamento, Log',
    'Configurações',
  ]);
});

test('itens escondidos somem, e o grupo vazio some junto', () => {
  const t = visibleNav(NAV_TREE, { hidden: ['/demands', '/broadcasts', '/private', '/contacts'], platformAdmin: true });
  assert.deepEqual(names(t), [
    'Dashboard',
    'Agenda',
    'Grupos: Painel de grupos, Grupos, Aguardando resposta',
    'Gestão: Empresas, Relatórios, Alertas, Acompanhamento, Log',
    'Configurações',
  ]);
});

test('quem não é administrador não vê Empresas, Acompanhamento nem Log', () => {
  const t = visibleNav(NAV_TREE, { hidden: ['/broadcasts'], platformAdmin: false });
  assert.deepEqual(names(t).filter((n) => n.startsWith('Gestão')), ['Gestão: Relatórios, Alertas']);
  // sem nenhum item visível, o grupo Gestão some inteiro
  const only = visibleNav(NAV_TREE, { hidden: ['/reports', '/alerts'], platformAdmin: false });
  assert.ok(!names(only).some((n) => n.startsWith('Gestão')));
});

test('o original não é alterado pelo filtro', () => {
  visibleNav(NAV_TREE, { hidden: ['/panel'], platformAdmin: false });
  assert.equal(group('grupos').items.length, 4);
});

test('página ativa e grupo da página', () => {
  assert.equal(isActive('/groups', '/groups'), true);
  assert.equal(isActive('/groups/abc', '/groups'), true);
  assert.equal(isActive('/groups-x', '/groups'), false);
  assert.equal(isActive('/private-media/1', '/private'), false);
  assert.equal(activeGroupId(NAV_TREE, '/broadcasts/new'), 'automacoes');
  assert.equal(activeGroupId(NAV_TREE, '/panel'), 'grupos');
  assert.equal(activeGroupId(NAV_TREE, '/contacts'), 'conversas');
  assert.equal(activeGroupId(NAV_TREE, '/dashboard'), null);
  assert.equal(activeGroupId(NAV_TREE, '/settings/users'), null);
});

test('contador do grupo: soma, cor do mais urgente e "99+"', () => {
  assert.deepEqual(groupBadge(group('grupos'), { pending: 14, demands: 3 }), { count: 17, kind: 'warning' });
  assert.deepEqual(groupBadge(group('grupos'), { demands: 3 }), { count: 3, kind: 'neutral' });
  assert.deepEqual(groupBadge(group('gestao'), { alerts: 120 }), { count: 120, kind: 'critical' });
  assert.equal(groupBadge(group('conversas'), { private: 28 })?.kind, 'good');
  assert.equal(groupBadge(group('grupos'), {}), null);
  assert.equal(groupBadge(group('automacoes'), { alerts: 9 }), null); // contador de item que não é do grupo não entra
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(badgeKind('agenda'), 'critical');
});

test('escolhas guardadas: lixo vira vazio', () => {
  assert.deepEqual(parseGroupPrefs('{"gestao":true,"grupos":false}'), { gestao: true, grupos: false });
  assert.deepEqual(parseGroupPrefs('{"gestao":"sim","ok":true}'), { ok: true });
  for (const bad of [null, undefined, '', 'não é json', '[1,2]', '"x"', '123', 'null']) assert.deepEqual(parseGroupPrefs(bad as string | null), {});
});

test('grupo aberto: o da página abre sozinho; os outros seguem a escolha ou o padrão', () => {
  const g = group('gestao');
  const base = { prefs: {}, closedHere: null, pathname: '/reports' };
  assert.equal(isGroupOpen({ ...base, group: g, activeId: 'gestao' }), true); // da página
  assert.equal(isGroupOpen({ ...base, group: g, activeId: null }), false); // padrão fechado
  assert.equal(isGroupOpen({ ...base, group: group('grupos'), activeId: null }), true); // padrão aberto
  assert.equal(isGroupOpen({ ...base, group: g, activeId: null, prefs: { gestao: true } }), true); // escolha
  assert.equal(isGroupOpen({ ...base, group: group('grupos'), activeId: null, prefs: { grupos: false } }), false);
  // fechou o grupo da página: fica fechado nesta página, e volta a abrir ao entrar em outra
  const closed = { id: 'gestao', path: '/reports' };
  assert.equal(isGroupOpen({ ...base, group: g, activeId: 'gestao', closedHere: closed }), false);
  assert.equal(isGroupOpen({ ...base, group: g, activeId: 'gestao', closedHere: closed, pathname: '/alerts' }), true);
});

test('administrador da empresa vê o Acompanhamento (da própria empresa), mas não Empresas nem Log', () => {
  const t = visibleNav(NAV_TREE, { hidden: ['/broadcasts'], platformAdmin: false, admin: true });
  assert.deepEqual(names(t).filter((n) => n.startsWith('Gestão')), ['Gestão: Relatórios, Alertas, Acompanhamento']);
});
