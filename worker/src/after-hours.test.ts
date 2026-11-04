import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterHoursNotice, notifyAfterHours, type AfterHoursRow } from './after-hours.js';

const row = (over: Partial<AfterHoursRow> = {}): AfterHoursRow => ({
  alert_group_id: 'alerta',
  group_id: 'g1',
  group_name: 'Cliente Alfa',
  pending_since: '2026-11-04T22:00:00Z',
  pending_count: 2,
  sla_seconds: 900,
  waiting_seconds: 2700,
  who: 'Maria',
  body: 'preciso de ajuda',
  message_type: 'text',
  ...over,
});

test('afterHoursNotice monta o aviso com o tempo, o limite e a mensagem do cliente', () => {
  assert.equal(
    afterHoursNotice(row(), 'https://app.exemplo.com'),
    [
      '🚨 SLA estourado fora do expediente',
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
    ['🚨 SLA estourado fora do expediente', 'Grupo: Cliente Alfa', 'Sem resposta há 1h15 (limite de 1h00) · 2 mensagem(ns)', 'Cliente: [image]'].join('\n'),
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
