import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinBusinessHours } from './business-hours.js';
import { contactCardsOf, extractContent, withMentions, findKeyword, isAcknowledgement, isStickerOrEmoji, messageChangeOf, phoneFromJid, quoteOf, quotedAuthor, reactionOf, samePhone } from './text.js';

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

test('isStickerOrEmoji reconhece só figurinha e emojis', () => {
  assert.ok(isStickerOrEmoji('sticker', null));
  assert.ok(isStickerOrEmoji('text', '👍'));
  assert.ok(isStickerOrEmoji('text', '🙏🏻🙏🏻 '));
  assert.ok(isStickerOrEmoji('text', '❤️'));
  assert.ok(isStickerOrEmoji('text', '👨‍👩‍👧 😂!'));
  assert.ok(isStickerOrEmoji('text', '🇧🇷'));
  assert.ok(!isStickerOrEmoji('text', 'ok 👍'));
  assert.ok(!isStickerOrEmoji('text', '123'));
  assert.ok(!isStickerOrEmoji('text', '?'));
  assert.ok(!isStickerOrEmoji('image', null));
  assert.ok(!isStickerOrEmoji('text', null));
});

test('pacotes técnicos do WhatsApp não viram mensagem', () => {
  for (const key of ['secretEncryptedMessage', 'encEventResponseMessage', 'encCommentMessage', 'placeholderMessage']) {
    assert.equal(extractContent({ [key]: {} } as never), null, key);
  }
  assert.deepEqual(extractContent({ conversation: 'oi' }), { type: 'text', body: 'oi' });
});

test('reação: id da mensagem reagida e o emoji (vazio = retirada)', () => {
  assert.deepEqual(reactionOf({ reactionMessage: { key: { id: 'ABC' }, text: '👍' } }), { targetId: 'ABC', emoji: '👍' });
  assert.deepEqual(reactionOf({ reactionMessage: { key: { id: 'ABC' }, text: '' } }), { targetId: 'ABC', emoji: '' });
  assert.equal(reactionOf({ conversation: 'oi' }), null);
  assert.equal(reactionOf({ reactionMessage: { text: '👍' } }), null);
});

test('mensagem apagada ou editada no WhatsApp', () => {
  assert.deepEqual(messageChangeOf({ protocolMessage: { type: 0, key: { id: 'M1' } } }), { kind: 'delete', targetId: 'M1' });
  assert.deepEqual(
    messageChangeOf({ protocolMessage: { type: 14, key: { id: 'M2' }, editedMessage: { conversation: 'texto novo' } } }),
    { kind: 'edit', targetId: 'M2', body: 'texto novo' },
  );
  assert.equal(messageChangeOf({ protocolMessage: { type: 3, key: { id: 'M3' } } }), null);
  assert.equal(messageChangeOf({ conversation: 'oi' }), null);
});

test('autor da mensagem citada', () => {
  assert.deepEqual(
    quotedAuthor({ extendedTextMessage: { text: 'ok', contextInfo: { stanzaId: 'Q1', participant: '123@lid' } } }),
    { id: 'Q1', participant: '123@lid' },
  );
  assert.equal(quotedAuthor({ extendedTextMessage: { text: 'ok', contextInfo: { stanzaId: 'Q1' } } }), null);
  assert.equal(quotedAuthor({ conversation: 'oi' }), null);
});

test('mensagem citada pela resposta (quoteOf)', () => {
  assert.deepEqual(
    quoteOf({
      extendedTextMessage: {
        text: 'Pode sim',
        contextInfo: { stanzaId: 'Q9', participant: '555@lid', quotedMessage: { conversation: 'Podemos conversar por ligação?' } },
      },
    }),
    { id: 'Q9', participant: '555@lid', type: 'text', body: 'Podemos conversar por ligação?' },
  );
  assert.equal(quoteOf({ conversation: 'oi' }), null);
});

test('isForwarded reconhece a mensagem encaminhada', async () => {
  const { isForwarded } = await import('./text.js');
  assert.equal(isForwarded({ extendedTextMessage: { text: 'oi', contextInfo: { isForwarded: true, forwardingScore: 1 } } }), true);
  assert.equal(isForwarded({ conversation: 'oi' }), false);
  assert.equal(isForwarded({ imageMessage: { caption: 'x', contextInfo: { isForwarded: true } } }), true);
});

test('contactCardsOf lê o telefone do cartão de contato (waid ou TEL)', () => {
  const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Maria Silva\nTEL;type=CELL;type=VOICE;waid=5551999998888:+55 51 99999-8888\nEND:VCARD';
  assert.deepEqual(contactCardsOf({ contactMessage: { displayName: 'Maria', vcard } }), [{ name: 'Maria', phone: '5551999998888' }]);
  const semWaid = 'BEGIN:VCARD\nFN:João\nitem1.TEL:(51) 3333-4444\nEND:VCARD';
  assert.deepEqual(contactCardsOf({ contactMessage: { vcard: semWaid } }), [{ name: 'João', phone: '5133334444' }]);
  assert.deepEqual(
    contactCardsOf({ contactsArrayMessage: { contacts: [{ displayName: 'A', vcard }, { displayName: 'B', vcard: 'BEGIN:VCARD\nFN:B\nEND:VCARD' }] } }),
    [{ name: 'A', phone: '5551999998888' }],
  );
  assert.deepEqual(contactCardsOf({ conversation: 'oi' }), []);
});

test('withMentions leva as pessoas marcadas no envio e ignora o que não é identificador', () => {
  assert.deepEqual(withMentions({ text: 'oi @5551999990001' }, ['5551999990001@s.whatsapp.net']), {
    text: 'oi @5551999990001',
    mentions: ['5551999990001@s.whatsapp.net'],
  });
  // LID, repetidos e inválidos
  assert.deepEqual(withMentions({ text: 'x' }, ['121839833624806@lid', '121839833624806@lid', 'joao@gmail.com', '']).mentions, ['121839833624806@lid']);
  // sem ninguém marcado o conteúdo não muda
  const content = { text: 'sem marcar' };
  assert.equal(withMentions(content, []), content);
  assert.equal(withMentions(content, null), content);
  assert.equal(withMentions(content, undefined), content);
  // legenda de arquivo com menção mantém o resto do conteúdo
  assert.deepEqual(withMentions({ image: 'buf', caption: 'veja @5551999990001' }, ['5551999990001@s.whatsapp.net']), {
    image: 'buf',
    caption: 'veja @5551999990001',
    mentions: ['5551999990001@s.whatsapp.net'],
  });
});
