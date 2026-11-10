import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventFrom, eventText, type PrivateChatEvent } from './private-chat-events.ts';

const ADMIN = 'u-admin';
const BIA = 'u-bia';
const ev = (p: Partial<PrivateChatEvent>) => ({ type: 'released' as const, note: null, user_id: ADMIN, metadata: {}, ...p });

test('liberação: quem liberou, de quem era e o motivo', () => {
  const e = ev({ note: ' cliente pediu outro atendente ', metadata: { by_name: 'Ana', from: BIA, from_name: 'Bia' } });
  assert.equal(eventText(e), 'Ana liberou a conversa de Bia — motivo: cliente pediu outro atendente');
  assert.equal(eventText(ev({ metadata: { by_name: 'Ana', from: BIA, from_name: 'Bia' } })), 'Ana liberou a conversa de Bia');
  assert.equal(eventFrom(e), BIA);
});

test('o próprio usuário aparece como "Você" / "você"', () => {
  const e = ev({ metadata: { by_name: 'Ana', from: BIA, from_name: 'Bia' } });
  assert.equal(eventText(e, ADMIN), 'Você liberou a conversa de Bia');
  assert.equal(eventText(e, BIA), 'Ana liberou a conversa de você');
});

test('transferência, assumir, reabrir e finalizar', () => {
  assert.equal(
    eventText(ev({ type: 'transferred', note: 'urgente', metadata: { by_name: 'Bia', from: BIA, from_name: 'Bia', to: 'c', to_name: 'Caio' } })),
    'Bia transferiu a conversa de Bia para Caio — obs.: urgente',
  );
  assert.equal(eventText(ev({ type: 'transferred', metadata: { by_name: 'Ana', to: 'c', to_name: 'Caio' } })), 'Ana transferiu a conversa para Caio');
  assert.equal(eventText(ev({ type: 'assigned', metadata: { by_name: 'Caio' } })), 'Caio assumiu a conversa');
  assert.equal(eventText(ev({ type: 'assigned', metadata: { by_name: 'Caio', reopened: true } })), 'Caio reabriu o atendimento');
  assert.equal(eventText(ev({ type: 'finished', metadata: { by_name: 'Caio' } })), 'Caio finalizou o atendimento');
});

test('sem nomes guardados não quebra', () => {
  assert.equal(eventText(ev({ user_id: null, metadata: null })), 'O sistema liberou a conversa de outro usuário');
  assert.equal(eventFrom(ev({ metadata: null })), null);
});
