import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followupBadge, matchesFollowup, type FollowupInfo } from './followup-view.ts';

const NOW = Date.UTC(2026, 10, 10, 15, 0, 0);
const promise: FollowupInfo = {
  followup_status: 'company',
  followup_kind: 'promise',
  followup_reason: 'Promessa da equipe ainda sem entrega',
  followup_excerpt: 'Vou verificar e te retorno até sexta',
  followup_actor: 'Julia',
  followup_due_at: new Date(NOW - 3600_000).toISOString(),
};

test('empresa deve, com prazo vencido e o motivo na dica', () => {
  const b = followupBadge(promise, NOW)!;
  assert.equal(b.side, 'company');
  assert.equal(b.label, 'Empresa deve');
  assert.equal(b.overdue, true);
  assert.match(b.title, /Promessa da equipe.*“Vou verificar e te retorno até sexta” \(Julia\).*\(vencido\)/);
});

test('cliente deve; sem pendência não tem etiqueta', () => {
  assert.equal(followupBadge({ followup_status: 'client' }, NOW)?.label, 'Cliente deve');
  assert.equal(followupBadge({ followup_status: 'resolved' }, NOW), null);
  assert.equal(followupBadge({}, NOW), null);
});

test('filtro do painel', () => {
  assert.equal(matchesFollowup(promise, 'all', NOW), true);
  assert.equal(matchesFollowup(promise, 'company', NOW), true);
  assert.equal(matchesFollowup(promise, 'client', NOW), false);
  assert.equal(matchesFollowup(promise, 'overdue', NOW), true);
  assert.equal(matchesFollowup({ ...promise, followup_due_at: new Date(NOW + 3600_000).toISOString() }, 'overdue', NOW), false);
  assert.equal(matchesFollowup({ followup_status: 'resolved' }, 'company', NOW), false);
});
