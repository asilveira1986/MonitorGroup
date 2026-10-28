import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactRow, isPrivateJid, realContactName } from './private-jid.js';

test('conversa privada: pessoa (número ou LID), não grupo, status ou canal', () => {
  assert.equal(isPrivateJid('5511999998888@s.whatsapp.net'), true);
  assert.equal(isPrivateJid('121839833624806@lid'), true);
  assert.equal(isPrivateJid('120363000000000000@g.us'), false);
  assert.equal(isPrivateJid('status@broadcast'), false);
  assert.equal(isPrivateJid('120363000000000000@newsletter'), false);
  assert.equal(isPrivateJid(null), false);
});

test('contato do WhatsApp vira linha de wa_contacts', () => {
  assert.deepEqual(
    { ...contactRow('i', 'c', { id: '121839833624806@lid', phoneNumber: '5551999990000@s.whatsapp.net', name: 'Cristian', notify: 'Cris' }), updated_at: 'x' },
    { instance_id: 'i', company_id: 'c', jid: '121839833624806@lid', lid: '121839833624806@lid', phone: '5551999990000', name: 'Cristian', notify: 'Cris', updated_at: 'x' },
  );
  assert.equal(contactRow('i', 'c', { id: '120363000000000000@g.us', name: 'Grupo' }), null);
  assert.equal(contactRow('i', 'c', { id: '5511999998888@s.whatsapp.net' })?.phone, '5511999998888');
});

test('nome do contato: número mascarado (ou só número) não é nome', () => {
  assert.equal(realContactName('+55∙∙∙∙∙∙∙∙11'), null);
  assert.equal(realContactName('+55········11'), null);
  assert.equal(realContactName('+55 51 99999-8888'), null);
  assert.equal(realContactName('  '), null);
  assert.equal(realContactName('Lucas Leal'), 'Lucas Leal');
  assert.equal(realContactName('Corá 🔥'), 'Corá 🔥');
  assert.equal(realContactName('🔥'), '🔥');
  assert.equal(realContactName('007'), '007');
  const row = contactRow('i', 'c', { id: '123456789012345@lid', name: '+55∙∙∙∙∙∙∙∙11', notify: 'Filipe' });
  assert.equal(row?.name, undefined);
  assert.equal(row?.notify, 'Filipe');
});
