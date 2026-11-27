import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offlineSummary, periodSeconds, reasonText, type ConnectionPeriod } from './connection-history.ts';

const NOW = new Date('2026-11-27T12:00:00Z').getTime();
const p = (id: string, instance: string, startH: number, endH: number | null, reason: string | null = null): ConnectionPeriod => ({
  id,
  instance_id: instance,
  started_at: new Date(NOW - startH * 3_600_000).toISOString(),
  ended_at: endH == null ? null : new Date(NOW - endH * 3_600_000).toISOString(),
  reason,
});

test('duração do período; o que está aberto vai até agora', () => {
  assert.equal(periodSeconds(p('1', 'a', 3, 2), NOW), 3600);
  assert.equal(periodSeconds(p('2', 'a', 2, null), NOW), 7200);
});

test('resumo: soma só a parte dentro da janela e conta as quedas da janela', () => {
  const periods = [
    p('1', 'a', 2, 1), // 1 h
    p('2', 'a', 30, 29), // 1 h, fora de 1 dia mas dentro de 7
    p('3', 'b', 5, null), // 5 h e continua fora
    p('4', 'a', 24 * 8, 24 * 7 - 1), // começou antes da janela de 7 dias e acabou dentro: conta 1 h, mas não é queda da janela
  ];
  const day = offlineSummary(periods, NOW, 1);
  assert.equal(day.seconds, (1 + 5) * 3600); // número a (1 h) + b (5 h)
  assert.equal(day.count, 2);
  const a = offlineSummary(periods, NOW, 7, 'a');
  assert.equal(a.seconds, 3 * 3600); // 1 + 1 + 1 (a parte do período 4 dentro da janela)
  assert.equal(a.count, 2);
  const share = offlineSummary([p('x', 'a', 12, null)], NOW, 1, 'a').share;
  assert.equal(share, 0.5);
  assert.equal(offlineSummary([p('x', 'a', 100, 90)], NOW, 1).seconds, 0);
});

test('motivo vazio vira texto padrão', () => {
  assert.equal(reasonText(null), 'Motivo não informado');
  assert.equal(reasonText('  '), 'Motivo não informado');
  assert.equal(reasonText('Sessão encerrada no celular.'), 'Sessão encerrada no celular.');
});
