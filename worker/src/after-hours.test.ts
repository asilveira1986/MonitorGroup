import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterHoursNotice, groupAfterHours, notifyAfterHours, type AfterHoursRow } from './after-hours.js';

const row = (over: Partial<AfterHoursRow> = {}): AfterHoursRow => ({
  alert_group_id: 'alerta',
  group_id: 'g1',
  group_name: 'Cliente Alfa',
  group_jid: null,
  pending_since: '2026-11-04T22:00:00Z',
  pending_count: 2,
  sla_seconds: 900,
  waiting_seconds: 2700,
  who: 'Maria',
  body: 'preciso de ajuda',
  message_type: 'text',
  last_client_at: '2026-11-04T22:30:00Z',
  ...over,
});

test('afterHoursNotice monta o aviso com o tempo, o limite e a mensagem do cliente', () => {
  assert.equal(
    afterHoursNotice(row(), 'https://app.exemplo.com'),
    [
      '🚨 GRUPO SEM RESPOSTA',
      'Grupo: Cliente Alfa',
      'Sem resposta há 45 min (limite de 15 min) · 2 mensagem(ns)',
      'Maria: "preciso de ajuda"',
      'https://app.exemplo.com/groups/g1',
    ].join('\n'),
  );
});

test('afterHoursNotice: mídia sem texto, horas e sem endereço do painel', () => {
  const text = afterHoursNotice(row({ body: null, message_type: 'image', who: null, waiting_seconds: 4500, sla_seconds: 3600 }), '');
  assert.equal(
    text,
    ['🚨 GRUPO SEM RESPOSTA', 'Grupo: Cliente Alfa', 'Sem resposta há 1h15 (limite de 1h00) · 2 mensagem(ns)', 'Cliente: [image]'].join('\n'),
  );
});

test('notifyAfterHours envia ao grupo de alertas, registra o aviso e segue quando um envio falha', async () => {
  const sent: { companyId: string; groupId: string; text: string }[] = [];
  const marked: string[] = [];
  const errors: string[] = [];
  const rows = [row({ group_id: 'g1' }), row({ group_id: 'g2', group_name: 'Cliente Beta' }), row({ group_id: 'g3', group_name: 'Cliente Gama' })];
  const count = await notifyAfterHours('empresa', rows, {
    appUrl: '',
    send: async (companyId, groupId, text) => {
      if (text.includes('Beta')) throw new Error('WhatsApp fora do ar');
      sent.push({ companyId, groupId, text });
    },
    markNotified: async (groupId, pendingSince) => void marked.push(`${groupId}@${pendingSince}`),
    onError: (err, r) => void errors.push(`${r.group_name}: ${(err as Error).message}`),
  });
  assert.equal(count, 2);
  assert.deepEqual(sent.map((s) => [s.companyId, s.groupId]), [['empresa', 'alerta'], ['empresa', 'alerta']]);
  assert.ok(sent[0].text.includes('Alfa') && sent[1].text.includes('Gama'));
  // quem falhou não é registrado: a próxima verificação tenta de novo
  assert.deepEqual(marked, ['g1@2026-11-04T22:00:00Z', 'g3@2026-11-04T22:00:00Z']);
  assert.deepEqual(errors, ['Cliente Beta: WhatsApp fora do ar']);
});

test('groupAfterHours junta as cópias do mesmo grupo (mesmo jid ou mesmo nome) e escolhe a de última mensagem', () => {
  const rows = [
    row({ group_id: 'a1', group_name: 'Cliente Alfa', group_jid: '123@g.us', last_client_at: '2026-11-04T22:00:00Z', body: 'antiga' }),
    row({ group_id: 'a2', group_name: 'Cliente Alfa (outro número)', group_jid: '123@g.us', last_client_at: '2026-11-04T22:40:00Z', body: 'nova' }),
    // sem o mesmo jid, mas com o mesmo nome (espaços e maiúsculas não contam)
    row({ group_id: 'a3', group_name: ' cliente  alfa ', group_jid: '999@g.us', last_client_at: '2026-11-04T21:00:00Z' }),
    row({ group_id: 'b1', group_name: 'Cliente Beta', group_jid: '456@g.us' }),
  ];
  const groups = groupAfterHours(rows);
  assert.equal(groups.length, 2);
  const alfa = groups.find((g) => g.members.some((m) => m.group_id === 'a1'))!;
  assert.deepEqual(alfa.members.map((m) => m.group_id).sort(), ['a1', 'a2', 'a3']);
  assert.equal(alfa.main.group_id, 'a2');
  assert.equal(alfa.main.body, 'nova');
});

test('notifyAfterHours manda um aviso só por grupo e registra todas as cópias como avisadas', async () => {
  const sent: string[] = [];
  const marked: string[] = [];
  const rows = [
    row({ group_id: 'a1', group_jid: '123@g.us', last_client_at: '2026-11-04T22:00:00Z', body: 'antiga' }),
    row({ group_id: 'a2', group_jid: '123@g.us', last_client_at: '2026-11-04T22:40:00Z', body: 'a mais recente' }),
  ];
  const count = await notifyAfterHours('empresa', rows, {
    appUrl: '',
    send: async (_c, _g, text) => void sent.push(text),
    markNotified: async (groupId) => void marked.push(groupId),
  });
  assert.equal(count, 1);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('a mais recente') && !sent[0].includes('antiga'));
  assert.deepEqual(marked.sort(), ['a1', 'a2']);
});

test('notifyAfterHours: se o envio falha, nenhuma cópia é registrada (tenta de novo depois)', async () => {
  const marked: string[] = [];
  const rows = [row({ group_id: 'a1', group_jid: '123@g.us' }), row({ group_id: 'a2', group_jid: '123@g.us' })];
  const count = await notifyAfterHours('empresa', rows, {
    appUrl: '',
    send: async () => {
      throw new Error('fora do ar');
    },
    markNotified: async (groupId) => void marked.push(groupId),
  });
  assert.equal(count, 0);
  assert.deepEqual(marked, []);
});
