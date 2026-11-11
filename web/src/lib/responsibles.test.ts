import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMINS_LABEL, matchesResponsible, withAdmins } from './responsibles.ts';

test('responsáveis: "administradores" acompanha os escolhidos só com a opção ligada', () => {
  assert.deepEqual(withAdmins(['Ana', 'Cíntia'], true), ['Ana', 'Cíntia', ADMINS_LABEL]);
  assert.deepEqual(withAdmins(['Ana'], false), ['Ana']);
  // grupo sem responsável escolhido continua "sem responsável" (para achar grupos sem dono)
  assert.deepEqual(withAdmins([], true), []);
  // não repete
  assert.deepEqual(withAdmins(['Ana', ADMINS_LABEL], true), ['Ana', ADMINS_LABEL]);
});

test('responsáveis: filtrar por um administrador mostra todos os grupos; por outra pessoa, só os dela', () => {
  const adminIds = ['admin1'];
  assert.equal(matchesResponsible({ selected: 'admin1', groupResponsibleIds: [], adminIds }), true);
  assert.equal(matchesResponsible({ selected: 'admin1', groupResponsibleIds: ['ana'], adminIds }), true);
  assert.equal(matchesResponsible({ selected: 'ana', groupResponsibleIds: ['ana'], adminIds }), true);
  assert.equal(matchesResponsible({ selected: 'ana', groupResponsibleIds: ['bia'], adminIds }), false);
  assert.equal(matchesResponsible({ selected: 'ana', groupResponsibleIds: [], adminIds: [] }), false);
});

test('cópias do mesmo grupo (mesmo jid ou nome) contam uma vez', async () => {
  const { dedupeGroups } = await import('./responsibles.ts');
  const list = [
    { name: 'Flores x Cotrijal', jid: 'a@g.us' },
    { name: 'flores  x cotrijal', jid: 'b@g.us' },
    { name: 'Outro nome', jid: 'a@g.us' },
    { name: 'Jurídico', jid: null },
  ];
  assert.deepEqual(dedupeGroups(list).map((g) => g.name), ['Flores x Cotrijal', 'Jurídico']);
});
