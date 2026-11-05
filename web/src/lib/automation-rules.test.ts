import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HHMM, normalizePhone, phoneToJid, validateRuleInput, validateTeamMember } from './automation-rules.ts';

const valid = { notifyGroupJid: '120363000000000001@g.us', notifyGroupName: 'Trabalhista' };

test('regra: notifyGroupJid é obrigatório na criação (e só na criação)', () => {
  const sem = validateRuleInput({ escalateAfterMin: 10 }, { creating: true });
  assert.equal(sem.ok, false);
  assert.match(sem.ok ? '' : sem.error, /grupo interno/);

  assert.equal(validateRuleInput({ notifyGroupJid: '' }, { creating: true }).ok, false);
  assert.equal(validateRuleInput({ notifyGroupJid: '5551999998888@s.whatsapp.net' }, { creating: true }).ok, false); // não é grupo

  const ok = validateRuleInput(valid, { creating: true });
  assert.equal(ok.ok, true);

  // na edição só os campos enviados são conferidos
  const edicao = validateRuleInput({ escalateAfterMin: 20 }, { creating: false });
  assert.deepEqual(edicao.ok && edicao.value, { escalateAfterMin: 20 });
});

test('regra: horário HH:MM válido', () => {
  for (const bom of ['00:00', '08:00', '18:30', '23:59']) assert.ok(HHMM.test(bom), bom);
  for (const ruim of ['24:00', '8:00', '08:60', '0800', '08:00:00', '', 'ab:cd']) assert.equal(HHMM.test(ruim), false, ruim);

  const ruim = validateRuleInput({ ...valid, businessStart: '25:00' }, { creating: true });
  assert.equal(ruim.ok, false);
  assert.match(ruim.ok ? '' : ruim.error, /HH:MM/);
  assert.equal(validateRuleInput({ businessEnd: '18h' }, { creating: false }).ok, false);

  const ok = validateRuleInput({ businessStart: ' 08:00 ', businessEnd: '18:00' }, { creating: false });
  assert.deepEqual(ok.ok && ok.value, { businessStart: '08:00', businessEnd: '18:00' });
});

test('regra: os números precisam ser inteiros maiores ou iguais a zero', () => {
  const ok = validateRuleInput({ ...valid, ackCooldownMin: '30', escalateAfterMin: 0, repeatEveryMin: 45, maxEscalations: 3 }, { creating: true });
  assert.deepEqual(ok.ok && ok.value, {
    ...valid,
    ackCooldownMin: 30,
    escalateAfterMin: 0,
    repeatEveryMin: 45,
    maxEscalations: 3,
  });
  for (const ruim of [-1, 1.5, 'abc', NaN, 1_000_000]) {
    assert.equal(validateRuleInput({ ...valid, escalateAfterMin: ruim }, { creating: true }).ok, false, String(ruim));
  }
});

test('regra: só aceita os campos editáveis, dias, pessoas marcadas e textos', () => {
  const r = validateRuleInput(
    { ...valid, id: 'x', groupId: 'outro', lastAckAt: 'hoje', company_id: 'c', enabled: true, escalateOffHours: false, businessDays: [5, 1, 1, 3], mentionJids: ['5551999990001@s.whatsapp.net'] },
    { creating: true },
  );
  assert.ok(r.ok);
  // id, groupId, lastAckAt e company_id não passam
  assert.deepEqual(Object.keys(r.ok ? r.value : {}).sort(), ['businessDays', 'enabled', 'escalateOffHours', 'mentionJids', 'notifyGroupJid', 'notifyGroupName']);
  assert.deepEqual(r.ok && r.value.businessDays, [1, 3, 5]);

  assert.equal(validateRuleInput({ businessDays: [] }, { creating: false }).ok, false);
  assert.equal(validateRuleInput({ businessDays: [7] }, { creating: false }).ok, false);
  assert.equal(validateRuleInput({ mentionJids: ['123'] }, { creating: false }).ok, false);
  assert.equal(validateRuleInput({ ackMessage: '   ' }, { creating: false }).ok, false);
  assert.equal(validateRuleInput({ ackMessage: 'x'.repeat(1001) }, { creating: false }).ok, false);
  assert.equal(validateRuleInput({ enabled: 'sim' }, { creating: false }).ok, false);
});

test('telefone da equipe: com DDI e pelo menos 12 dígitos', () => {
  assert.equal(normalizePhone('+55 (51) 99999-8888'), '5551999998888');
  assert.equal(normalizePhone('5551999998888'), '5551999998888');
  assert.equal(normalizePhone('51999998888'), null); // sem DDI
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('1234567890123456'), null); // longo demais
  assert.equal(phoneToJid('5551999998888'), '5551999998888@s.whatsapp.net');

  assert.deepEqual(validateTeamMember({ name: ' Carla ', phone: '+55 51 99999-8888' }), { ok: true, value: { name: 'Carla', phone: '5551999998888' } });
  const semFone = validateTeamMember({ name: 'Carla', phone: '999' });
  assert.equal(semFone.ok, false);
  assert.match(semFone.ok ? '' : semFone.error, /Telefone inválido/);
  assert.equal(validateTeamMember({ name: '', phone: '5551999998888' }).ok, false);
});
