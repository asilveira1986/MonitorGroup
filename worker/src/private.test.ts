import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactRow, isPrivateJid } from './private-jid.js';

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
