import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_BROADCAST_SETTINGS,
  estimateSeconds,
  formatEstimate,
  groupCounts,
  hasCriteria,
  renderBroadcast,
  settingsFromRow,
  mediaTypeFromMime,
  normalizeBrPhone,
  parseContactsCsv,
  totalOf,
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
