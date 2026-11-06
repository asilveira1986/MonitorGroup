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
  totalOf,
  validateBroadcastSettings,
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
