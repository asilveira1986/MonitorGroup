import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BROADCAST_SETTINGS,
  describeRecurrence,
  describeTrigger,
  estimateSeconds,
  formatEstimate,
  groupCounts,
  hasCriteria,
  renderBroadcast,
  settingsFromRow,
  mediaTypeFromMime,
  normalizeBrPhone,
  parseContactsCsv,
  percentOf,
  totalOf,
  validateRecurrence,
  validateTrigger,
  validateBroadcastSettings,
  validateWindow,
} from './broadcast.ts';

test('sem critério o filtro não escolhe ninguém', () => {
  assert.equal(hasCriteria({ target: 'groups' }), false);
  assert.equal(hasCriteria({ target: 'groups', tag_ids: [] }), false);
  assert.equal(hasCriteria({ target: 'groups', all: true }), true);
  assert.equal(hasCriteria({ target: 'people', tag_ids: ['t'] }), true);
  assert.equal(hasCriteria({ target: 'people', phones: ['5511999990000'] }), true);
  assert.equal(hasCriteria({ target: 'groups', sector_id: 's' }), true);
});

test('o texto troca as variáveis como o worker', () => {
  assert.equal(renderBroadcast('Olá {primeiro_nome}, tudo bem?', 'Maria da Silva'), 'Olá Maria, tudo bem?');
  assert.equal(renderBroadcast('Olá {nome}, tudo bem?', null), 'Olá, tudo bem?');
  assert.equal(renderBroadcast('Aviso para {grupo}', 'Clientes'), 'Aviso para Clientes');
});

test('ritmo: padrão, leitura da linha e validação', () => {
  assert.deepEqual(settingsFromRow(null), DEFAULT_BROADCAST_SETTINGS);
  assert.equal(settingsFromRow({ broadcast_daily_limit: 50 }).dailyLimit, 50);
  assert.deepEqual(validateBroadcastSettings(DEFAULT_BROADCAST_SETTINGS), { ok: true });
  assert.equal(validateBroadcastSettings({ ...DEFAULT_BROADCAST_SETTINGS, minDelayS: 1 }).ok, false);
  assert.equal(validateBroadcastSettings({ ...DEFAULT_BROADCAST_SETTINGS, minDelayS: 30, maxDelayS: 10 }).ok, false);
  assert.equal(validateBroadcastSettings({ ...DEFAULT_BROADCAST_SETTINGS, dailyLimit: 0 }).ok, false);
  assert.equal(validateBroadcastSettings({ ...DEFAULT_BROADCAST_SETTINGS, batchSize: 2.5 }).ok, false);
});

test('estimativa de tempo', () => {
  const s = { minDelayS: 10, maxDelayS: 10, batchSize: 10, batchPauseMin: 5, dailyLimit: 1000 };
  assert.equal(estimateSeconds(0, s), 0);
  assert.equal(estimateSeconds(1, s), 0);
  assert.equal(estimateSeconds(11, s), 10 * 10 + 5 * 60); // 10 intervalos + 1 pausa de lote
  assert.equal(formatEstimate(30), 'menos de 1 minuto');
  assert.equal(formatEstimate(20 * 60), 'cerca de 20 min');
  assert.equal(formatEstimate(90 * 60), 'cerca de 1 h 30 min');
});

test('contagens por campanha', () => {
  const m = groupCounts([
    { campaign_id: 'a', status: 'sent', n: 3 },
    { campaign_id: 'a', status: 'failed', n: '1' },
    { campaign_id: 'b', status: 'pending', n: 2 },
  ]);
  assert.equal(m.get('a')!.sent, 3);
  assert.equal(totalOf(m.get('a')!), 4);
  assert.equal(m.get('b')!.pending, 2);
});

test('tipo do arquivo pelo MIME', () => {
  assert.equal(mediaTypeFromMime('image/png'), 'image');
  assert.equal(mediaTypeFromMime('image/svg+xml'), 'document');
  assert.equal(mediaTypeFromMime('video/mp4'), 'video');
  assert.equal(mediaTypeFromMime('audio/ogg'), 'audio');
  assert.equal(mediaTypeFromMime('application/pdf'), 'document');
  assert.equal(mediaTypeFromMime(''), 'document');
});

test('janela de horário', () => {
  assert.deepEqual(validateWindow({ days: [1], start: '08:00', end: '18:00' }), { ok: true });
  assert.equal(validateWindow({ days: [], start: '08:00', end: '18:00' }).ok, false);
  assert.equal(validateWindow({ days: [1], start: '8h', end: '18:00' }).ok, false);
  assert.equal(validateWindow({ days: [1], start: '09:00', end: '09:00' }).ok, false);
  assert.deepEqual(validateWindow({ days: [1], start: '22:00', end: '06:00' }), { ok: true }); // atravessa a meia-noite
});

test('telefone brasileiro', () => {
  assert.equal(normalizeBrPhone('(11) 99999-0001'), '5511999990001');
  assert.equal(normalizeBrPhone('+55 11 99999-0001'), '5511999990001');
  assert.equal(normalizeBrPhone('1133334444'), '551133334444');
  assert.equal(normalizeBrPhone('99999-0001'), null);
  assert.equal(normalizeBrPhone('abc'), null);
});

test('CSV com cabeçalho e ponto e vírgula', () => {
  const r = parseContactsCsv('Nome;Telefone\nMaria Silva;(11) 99999-0001\n"João";11 99999-0002\nSem número;\nMaria de novo;5511999990001\n');
  assert.deepEqual(r.rows, [
    { phone: '5511999990001', name: 'Maria Silva' },
    { phone: '5511999990002', name: 'João' },
  ]);
  assert.equal(r.invalid, 1);
  assert.equal(r.duplicates, 1);
});

test('CSV sem cabeçalho: só telefones, ou nome e telefone em qualquer ordem', () => {
  assert.deepEqual(parseContactsCsv('11999990001\n11999990002').rows.map((x) => x.phone), ['5511999990001', '5511999990002']);
  const r = parseContactsCsv('11999990001,Ana\nBruno,11999990002');
  assert.deepEqual(r.rows, [
    { phone: '5511999990001', name: 'Ana' },
    { phone: '5511999990002', name: 'Bruno' },
  ]);
});

test('CSV com colunas fora de ordem, BOM e tab', () => {
  const r = parseContactsCsv('\uFEFFtelefone\tnome\tempresa\n11999990001\tAna\tX\n');
  assert.deepEqual(r.rows, [{ phone: '5511999990001', name: 'Ana' }]);
  assert.deepEqual(parseContactsCsv('').rows, []);
});

test('inatividade conta como critério do filtro', () => {
  assert.equal(hasCriteria({ target: 'groups', inactive_days: 30 }), true);
  assert.equal(hasCriteria({ target: 'groups', inactive_days: 0 }), false);
});

test('recorrência: validação', () => {
  assert.deepEqual(validateRecurrence({ freq: 'daily', time: '09:00' }), { ok: true });
  assert.deepEqual(validateRecurrence({ freq: 'weekly', time: '09:00', days: [1, 3] }), { ok: true });
  assert.equal(validateRecurrence({ freq: 'weekly', time: '09:00', days: [] }).ok, false);
  assert.equal(validateRecurrence({ freq: 'monthly', time: '09:00', day_of_month: 32 }).ok, false);
  assert.deepEqual(validateRecurrence({ freq: 'monthly', time: '18:30', day_of_month: 31, until: '2026-12-31' }), { ok: true });
  assert.equal(validateRecurrence({ freq: 'daily', time: '9h' }).ok, false);
  assert.equal(validateRecurrence({ freq: 'daily', time: '09:00', until: '31/12/2026' }).ok, false);
});

test('recorrência: descrição em português', () => {
  assert.equal(describeRecurrence({ freq: 'daily', time: '09:00' }), 'Todo dia às 09:00');
  assert.equal(describeRecurrence({ freq: 'weekly', time: '09:00', days: [3, 1] }), 'Toda segunda e quarta às 09:00');
  assert.equal(describeRecurrence({ freq: 'weekly', time: '08:30', days: [1, 3, 5] }), 'Toda segunda, quarta e sexta às 08:30');
  assert.equal(describeRecurrence({ freq: 'monthly', time: '10:00', day_of_month: 5, until: '2026-12-31' }), 'Todo dia 5 do mês às 10:00 (até 31/12/2026)');
  assert.equal(describeRecurrence(null), '');
});

test('percentual do relatório', () => {
  assert.equal(percentOf(1, 4), '25%');
  assert.equal(percentOf(2, 3), '67%');
  assert.equal(percentOf(0, 0), '—');
});

const trig = { name: 'Boas-vindas', kind: 'tag_applied' as const, tagId: 't1', sendTime: '09:00', target: 'people' as const, instanceId: 'i1', message: 'Olá {primeiro_nome}!', optoutFooter: true, includeExisting: false };

test('gatilho: validação', () => {
  assert.deepEqual(validateTrigger(trig), { ok: true });
  assert.equal(validateTrigger({ ...trig, name: ' ' }).ok, false);
  assert.equal(validateTrigger({ ...trig, message: '' }).ok, false);
  assert.equal(validateTrigger({ ...trig, tagId: null }).ok, false);
  assert.equal(validateTrigger({ ...trig, instanceId: null }).ok, false);
  assert.deepEqual(validateTrigger({ ...trig, target: 'groups', instanceId: null }), { ok: true });
  assert.deepEqual(validateTrigger({ ...trig, kind: 'birthday', tagId: null }), { ok: true });
  assert.equal(validateTrigger({ ...trig, kind: 'birthday', tagId: null, sendTime: '9h' }).ok, false);
  assert.equal(validateTrigger({ ...trig, kind: 'birthday', tagId: null, target: 'groups', instanceId: null }).ok, false);
});

test('gatilho: descrição', () => {
  assert.equal(describeTrigger({ kind: 'birthday', target: 'people', send_time: '09:00' }), 'No aniversário do contato, às 09:00');
  assert.equal(describeTrigger({ kind: 'tag_applied', target: 'people', send_time: '09:00' }, 'Novo cliente'), 'Quando alguém receber a etiqueta Novo cliente');
  assert.equal(describeTrigger({ kind: 'tag_applied', target: 'groups', send_time: '09:00' }, 'VIP'), 'Quando um grupo receber a etiqueta VIP');
});
