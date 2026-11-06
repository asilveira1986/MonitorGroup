import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OPTIONS, validateClosingFlow, validateOptions } from './closing-flows.ts';

const G1 = '11111111-1111-4111-8111-111111111111';
const base = { name: 'Pesquisa', question: 'Resolvido?', options: DEFAULT_OPTIONS, groupIds: [G1], notifyGroupJid: 'interno@g.us', notifyGroupName: 'Trabalhista' };

describe('validateClosingFlow', () => {
  it('aceita a regra padrão e aplica os tempos padrão', () => {
    const r = validateClosingFlow(base);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.delayMin, 5);
      assert.equal(r.value.expireHours, 24);
      assert.equal(r.value.enabled, true);
    }
  });
  it('exige nome, pergunta e grupos', () => {
    assert.equal(validateClosingFlow({ ...base, name: ' ' }).ok, false);
    assert.equal(validateClosingFlow({ ...base, question: '' }).ok, false);
    assert.equal(validateClosingFlow({ ...base, groupIds: [] }).ok, false);
  });
  it('exige o grupo interno quando uma opção avisa ou reabre', () => {
    assert.equal(validateClosingFlow({ ...base, notifyGroupJid: '' }).ok, false);
    const quiet = [
      { label: 'Sim', reply: 'ok' },
      { label: 'Não', reply: '' },
    ];
    assert.equal(validateClosingFlow({ ...base, options: quiet, notifyGroupJid: '' }).ok, true);
  });
  it('confere os tempos e as pessoas marcadas', () => {
    assert.equal(validateClosingFlow({ ...base, delayMin: '-1' }).ok, false);
    assert.equal(validateClosingFlow({ ...base, expireHours: 0 }).ok, false);
    assert.equal(validateClosingFlow({ ...base, delayMin: '10' }).ok, true);
    assert.equal(validateClosingFlow({ ...base, mentionJids: ['abc'] }).ok, false);
    assert.equal(validateClosingFlow({ ...base, mentionJids: ['5551999998888@s.whatsapp.net'] }).ok, true);
  });
});

describe('validateOptions', () => {
  it('pede de 2 a 6 opções, com texto e sem repetição', () => {
    assert.equal(validateOptions([{ label: 'Só uma' }]).ok, false);
    assert.equal(validateOptions(Array.from({ length: 7 }, (_, i) => ({ label: `O${i}` }))).ok, false);
    assert.equal(validateOptions([{ label: 'Sim' }, { label: 'sim' }]).ok, false);
    assert.equal(validateOptions([{ label: 'Sim' }, { label: ' ' }]).ok, false);
    assert.equal(validateOptions('x').ok, false);
  });
  it('normaliza os campos', () => {
    const r = validateOptions([{ label: ' Sim ', reply: ' ok ', reopen: true }, { label: 'Não' }]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value[0], { label: 'Sim', reply: 'ok', reopen: true, notify: false });
  });
});
