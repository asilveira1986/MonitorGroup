import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinBusinessHours } from './business-hours.js';
import { extractContent, findKeyword, isAcknowledgement, phoneFromJid, samePhone } from './text.js';

test('findKeyword ignora acentos e maiúsculas e respeita palavra inteira', () => {
  assert.equal(findKeyword('Isso é URGENTE!!', ['urgente']), 'urgente');
  assert.equal(findKeyword('quero fazer uma reclamacao', ['reclamação']), 'reclamação');
  assert.equal(findKeyword('emergentemente', ['urgente']), null);
  assert.equal(findKeyword(null, ['urgente']), null);
});

test('phoneFromJid extrai o telefone', () => {
  assert.equal(phoneFromJid('5511999998888@s.whatsapp.net'), '5511999998888');
  assert.equal(phoneFromJid('5511999998888:12@s.whatsapp.net'), '5511999998888');
  assert.equal(phoneFromJid('123456@lid'), null);
});

test('samePhone tolera o nono dígito', () => {
  assert.ok(samePhone('5511999998888', '551199998888'));
  assert.ok(!samePhone('5511999998888', '5511999997777'));
});

test('extractContent reconhece texto, legenda e ignora reações', () => {
  assert.deepEqual(extractContent({ conversation: 'oi' }), { type: 'text', body: 'oi' });
  assert.deepEqual(extractContent({ imageMessage: { caption: 'foto' } }), { type: 'image', body: 'foto' });
  assert.equal(extractContent({ reactionMessage: { text: '👍' } }), null);
});

test('isWithinBusinessHours usa o fuso horário', () => {
  const opts = { timezone: 'America/Sao_Paulo', businessDays: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };
  // quinta-feira 2026-10-01 12:00 em São Paulo = 15:00 UTC
  assert.ok(isWithinBusinessHours(new Date('2026-10-01T15:00:00Z'), opts));
  // 20:00 em São Paulo
  assert.ok(!isWithinBusinessHours(new Date('2026-10-01T23:00:00Z'), opts));
  // sábado
  assert.ok(!isWithinBusinessHours(new Date('2026-10-03T15:00:00Z'), opts));
});

test('isAcknowledgement reconhece agradecimentos', () => {
  assert.ok(isAcknowledgement('text', 'Obrigado!'));
  assert.ok(isAcknowledgement('text', '👍'));
  assert.ok(isAcknowledgement('text', 'ok obrigada'));
  assert.ok(isAcknowledgement('sticker', null));
  assert.ok(!isAcknowledgement('text', 'ok, mas e o boleto?'));
  assert.ok(!isAcknowledgement('image', null));
  // combinações curtas de agradecimento/confirmação
  assert.ok(isAcknowledgement('text', 'Recebi, obrigado!'));
  assert.ok(isAcknowledgement('text', 'show, valeu pessoal 👍'));
  assert.ok(isAcknowledgement('text', 'Deu certo, muito obrigada pela ajuda'));
  // pedidos e perguntas continuam abrindo pendência
  assert.ok(!isAcknowledgement('text', 'obrigado, e o boleto?'));
  assert.ok(!isAcknowledgement('text', 'recebi mas não abre'));
  assert.ok(!isAcknowledgement('text', 'ok, pode mandar o orçamento'));
});
