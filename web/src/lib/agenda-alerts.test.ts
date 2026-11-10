import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newEventSpeech, newEventWhen, reminderKey, reminderSpeech, reminderTone, reminderWhen, unseenReminders, type AgendaReminder } from './agenda-alerts.ts';

const base: AgendaReminder = { event_id: 'e1', title: 'Reunião com o cliente', starts_at: '2026-11-10T17:30:00Z', all_day: false, minutes: 15, fire_at: '2026-11-10T17:15:00Z', label: 'em 15 min' };

test('cada lembrete (evento, horário e minutos) é mostrado uma vez', () => {
  const seen = new Set([reminderKey(base)]);
  const other = { ...base, minutes: 0, label: 'agora' };
  const moved = { ...base, starts_at: '2026-11-10T18:00:00Z' };
  assert.deepEqual(unseenReminders([base, other, moved, other], (k) => seen.has(k)).map((r) => [r.minutes, r.starts_at]), [
    [0, base.starts_at],
    [15, moved.starts_at],
  ]);
});

test('horário no fuso da empresa e dia todo', () => {
  assert.equal(reminderWhen(base, 'America/Sao_Paulo'), '14:30');
  assert.equal(reminderWhen({ starts_at: base.starts_at, all_day: true }, 'America/Sao_Paulo'), 'Dia todo');
});

test('tom e frase falada', () => {
  assert.equal(reminderTone(base), 'warning');
  assert.equal(reminderTone({ minutes: 0, all_day: false }), 'critical');
  assert.equal(reminderTone({ minutes: 0, all_day: true }), 'warning');
  assert.equal(reminderSpeech(base), 'Compromisso em 15 min: Reunião com o cliente.');
  assert.equal(reminderSpeech({ label: 'agora', title: '  Ligar   para o Roberto ' }), 'Compromisso agora: Ligar para o Roberto.');
});

test('compromisso novo: hoje, amanhã, outra data e dia todo (fuso do aparelho)', () => {
  const tz = 'America/Sao_Paulo';
  const now = Date.UTC(2026, 10, 10, 15, 0, 0); // 10/11 às 12:00 em Brasília
  assert.equal(newEventWhen('2026-11-10T17:30:00Z', false, tz, now), 'hoje às 14:30');
  assert.equal(newEventWhen('2026-11-11T12:00:00Z', false, tz, now), 'amanhã às 09:00');
  assert.equal(newEventWhen('2026-11-20T12:00:00Z', false, tz, now), '20/11 às 09:00');
  assert.equal(newEventWhen('2026-11-12T15:00:00Z', true, tz, now), '12/11 · dia todo');
  // virada do dia no fuso: 02:00 UTC de 11/11 ainda é 10/11 à noite em Brasília
  assert.equal(newEventWhen('2026-11-11T02:00:00Z', false, tz, now), 'hoje às 23:00');
});

test('compromisso novo: frase falada', () => {
  assert.equal(newEventSpeech('Reunião com o cliente', 'amanhã às 09:00', 'Ana'), 'Ana marcou um compromisso para você: Reunião com o cliente, amanhã às 09:00.');
  assert.equal(newEventSpeech('Ligar', '12/11 · dia todo', null), 'Novo compromisso na sua agenda: Ligar, 12/11, dia todo.');
});
