import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memberIdsOf, parseAgendaFilter, type AgendaPerson, type AgendaTeamRef } from './agenda-filter.ts';

const ME = 'u-me';
const people: AgendaPerson[] = [
  { id: ME, name: 'Eu', member_ids: ['m-me'] },
  { id: 'u-ana', name: 'Ana', member_ids: ['m-ana'] },
  { id: 'u-bia', name: 'Bia', member_ids: [] },
  { id: 'u-caio', name: 'Caio', member_ids: ['m-caio'] },
];
const teams: AgendaTeamRef[] = [
  { id: 's-civel', name: 'Cível', userIds: ['u-ana', 'u-bia'] },
  { id: 's-trab', name: 'Trabalhista', userIds: ['u-bia', 'u-caio'] },
];

test('sem filtro: a própria agenda', () => {
  const f = parseAgendaFilter({}, people, teams, ME);
  assert.deepEqual(f.userIds, [ME]);
  assert.equal(f.filtering, false);
  assert.equal(f.viewingOther, false);
  assert.equal(f.multi, false);
  assert.deepEqual(memberIdsOf(f, people, ME, ['m-me']), ['m-me']);
});

test('vários usuários: união sem repetir, ignora id que não existe', () => {
  const f = parseAgendaFilter({ quem: 'u-ana,u-caio,u-fantasma,u-ana' }, people, teams, ME);
  assert.deepEqual(f.selectedUsers, ['u-ana', 'u-caio']);
  assert.deepEqual(f.userIds, ['u-ana', 'u-caio']);
  assert.equal(f.viewingOther, true);
  assert.equal(f.multi, true);
  assert.deepEqual(memberIdsOf(f, people, ME, ['m-me']), ['m-ana', 'm-caio']);
});

test('vários setores: as pessoas de todos os setores, sem repetir', () => {
  const f = parseAgendaFilter({ setor: 's-civel,s-trab' }, people, teams, ME);
  assert.deepEqual(f.userIds.sort(), ['u-ana', 'u-bia', 'u-caio']);
  assert.equal(f.label, 'setor Cível, setor Trabalhista');
});

test('usuários e setores juntos, e "eu" na mistura traz as demandas da própria pessoa', () => {
  const f = parseAgendaFilter({ quem: `${ME},u-caio`, setor: 's-civel' }, people, teams, ME);
  assert.deepEqual(f.userIds.sort(), [ME, 'u-ana', 'u-bia', 'u-caio'].sort());
  assert.deepEqual(memberIdsOf(f, people, ME, ['m-me', 'm-extra']).sort(), ['m-ana', 'm-caio', 'm-extra', 'm-me']);
});

test('só eu escolhido: continua sendo a própria agenda (sem "ver outro")', () => {
  const f = parseAgendaFilter({ quem: ME }, people, teams, ME);
  assert.equal(f.viewingOther, false);
  assert.equal(f.label, 'minha agenda');
});

test('aceita parâmetro repetido (array) e valores inválidos', () => {
  assert.deepEqual(parseAgendaFilter({ quem: ['u-ana', 'u-bia'] }, people, teams, ME).selectedUsers, ['u-ana', 'u-bia']);
  const none = parseAgendaFilter({ quem: 'x', setor: 'y' }, people, teams, ME);
  assert.equal(none.filtering, false);
  assert.deepEqual(none.userIds, [ME]);
});

test('rótulo longo: três nomes e "mais N"', () => {
  const f = parseAgendaFilter({ quem: 'u-ana,u-bia,u-caio', setor: 's-civel,s-trab' }, people, teams, ME);
  assert.match(f.label, /e mais 2$/);
});
