import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminMemberIds, jidsOf, memberJid, resolveJids, type MemberLite } from './responsibles.js';

const m = (id: string, over: Partial<MemberLite> = {}): MemberLite => ({ id, phone: `5551900000${id.padStart(3, '0')}`, jid: null, active: true, user_email: null, ...over });

test('memberJid: usa o jid descoberto; senão o telefone limpo; sem nenhum, null', () => {
  assert.equal(memberJid({ jid: 'x@lid', phone: '5551' }), 'x@lid');
  assert.equal(memberJid({ jid: null, phone: '+55 (51) 99999-8888' }), '5551999998888@s.whatsapp.net');
  assert.equal(memberJid({ jid: null, phone: null }), null);
  assert.equal(memberJid({ jid: null, phone: 'abc' }), null);
});

test('jidsOf: só ativos e com WhatsApp, sem repetir', () => {
  const members = [m('1'), m('2', { active: false }), m('3', { phone: null }), m('4', { jid: '5551900000001@s.whatsapp.net' })];
  assert.deepEqual(jidsOf(['1', '2', '3', '4', 'x', '1'], members), ['5551900000001@s.whatsapp.net']);
});

test('adminMemberIds: e-mail de acesso de administrador, sem ligar para maiúsculas e espaços; só pessoas ativas', () => {
  const members = [
    m('1', { user_email: '  Ana@X.com ' }),
    m('2', { user_email: 'bia@x.com' }),
    m('3', { user_email: 'ana@x.com', active: false }),
    m('4', { user_email: null }),
  ];
  assert.deepEqual(adminMemberIds(members, ['ana@x.com']), ['1']);
  assert.deepEqual(adminMemberIds(members, []), []);
  assert.deepEqual(adminMemberIds(members, ['', '  ']), []);
});

test('resolveJids: administradores entram junto dos responsáveis do grupo (não do setor), sem repetir', () => {
  const members = [m('1'), m('2'), m('3'), m('9')];
  const r = resolveJids({ groupIds: ['1'], sectorIds: ['2'], adminIds: ['9', '1'], members });
  assert.deepEqual(r.group, [memberJid(members[0])!, memberJid(members[3])!]);
  assert.deepEqual(r.sector, [memberJid(members[1])!]);
  // sem administradores: como antes
  const sem = resolveJids({ groupIds: ['1'], sectorIds: ['2'], adminIds: [], members });
  assert.deepEqual(sem.group, [memberJid(members[0])!]);
  // grupo sem responsável escolhido, mas com administradores: só eles
  assert.deepEqual(resolveJids({ groupIds: [], sectorIds: [], adminIds: ['9'], members }).group, [memberJid(members[3])!]);
});
