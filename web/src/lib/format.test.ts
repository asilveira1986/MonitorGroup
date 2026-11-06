import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_INITIALS, formatSize, initials } from './format.ts';

test('initials: até 2 letras; "?" quando o nome é vazio (avatar)', () => {
  assert.equal(initials('Maria Silva Santos'), 'MS');
  assert.equal(initials('joão'), 'J');
  assert.equal(initials('  ana   paula  '), 'AP');
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
  // sem filtro de letras, "+55" conta como palavra
  assert.equal(initials('+55 11 99999'), '+1');
});

test('initials: lista de membros usa vazio como reserva (a tela mostra um ícone)', () => {
  assert.equal(initials('', { fallback: '' }), '');
  assert.equal(initials('Carlos Dias', { fallback: '' }), 'CD');
});

test('initials de contatos e conversas: só palavras que começam com letra, "#" quando é só número', () => {
  assert.equal(initials('Maria Silva', CONTACT_INITIALS), 'MS');
  assert.equal(initials('+55 (51) 99999-8888', CONTACT_INITIALS), '#');
  assert.equal(initials('(51) Maria Souza', CONTACT_INITIALS), 'MS');
  assert.equal(initials('', CONTACT_INITIALS), '#');
});

test('formatSize: KB até 1 MB, MB com uma casa, vazio quando não se sabe', () => {
  assert.equal(formatSize(null), '');
  assert.equal(formatSize(undefined), '');
  assert.equal(formatSize(0), '1 KB');
  assert.equal(formatSize(1500), '1 KB');
  assert.equal(formatSize(320 * 1024), '320 KB');
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.equal(formatSize(4.25 * 1024 * 1024), '4.3 MB');
});
