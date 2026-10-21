import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertRecipients, type RecipientMember } from './recipients.js';

const members: RecipientMember[] = [
  { id: 'ana', phone: '5511999990001', user_email: 'ana@x.com', alerts_own_groups_only: true },
  { id: 'bia', phone: '5511999990002', user_email: 'bia@x.com', alerts_own_groups_only: false },
  { id: 'caio', phone: '5511999990003', user_email: null, alerts_own_groups_only: true },
];
const base = { members, notifyResponsibles: false, responsibleIds: [] as string[] };

test('regra sem responsáveis: quem recebe só dos seus grupos sai dos grupos dos outros', () => {
  const r = alertRecipients({
    ...base,
    phones: ['5511999990001', '5511999990002', '5511988887777'],
    emails: ['ana@x.com', 'gestor@x.com'],
    groupId: 'g1',
    responsibleIds: ['bia'],
  });
  assert.deepEqual(r.phones, ['5511999990002', '5511988887777']);
  assert.deepEqual(r.emails, ['gestor@x.com']);
});

test('responsável com restrição continua recebendo do próprio grupo (tolerando o 9º dígito)', () => {
  const r = alertRecipients({ ...base, phones: ['551199990001'], emails: ['ANA@x.com'], groupId: 'g1', responsibleIds: ['ana'] });
  assert.deepEqual(r.phones, ['551199990001']);
  assert.deepEqual(r.emails, ['ana@x.com']);
});

test('avisar os responsáveis do grupo: soma telefone e e-mail deles, sem repetir', () => {
  const r = alertRecipients({
    ...base,
    notifyResponsibles: true,
    phones: ['5511999990002'],
    emails: [],
    groupId: 'g1',
    responsibleIds: ['bia', 'caio'],
  });
  assert.deepEqual(r.phones, ['5511999990002', '5511999990003']);
  assert.deepEqual(r.emails, ['bia@x.com']);
});

test('grupo sem responsável avisa todos da regra', () => {
  const r = alertRecipients({ ...base, phones: ['5511999990001', '5511999990003'], emails: ['ana@x.com'], groupId: 'g2', responsibleIds: [] });
  assert.deepEqual(r.phones, ['5511999990001', '5511999990003']);
  assert.deepEqual(r.emails, ['ana@x.com']);
});

test('alerta sem grupo vai para todos da regra', () => {
  const r = alertRecipients({ ...base, notifyResponsibles: true, phones: ['5511999990001'], emails: ['ana@x.com'], groupId: null });
  assert.deepEqual(r.phones, ['5511999990001']);
  assert.deepEqual(r.emails, ['ana@x.com']);
});
