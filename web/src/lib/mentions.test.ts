import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMentions, filterMentionMembers, findMentionTrigger, mentionLabel, type MentionMember } from './mentions.ts';

const members: MentionMember[] = [
  { jid: '5551999990001@s.whatsapp.net', phone: '5551999990001', name: 'Maria Silva' },
  { jid: '5551999990002@s.whatsapp.net', phone: '5551999990002', name: 'João Pereira' },
  { jid: '5551999990003@s.whatsapp.net', phone: '5551999990003', name: 'Ana' },
  { jid: '5551999990004@s.whatsapp.net', phone: '5551999990004', name: 'Ana Paula' },
  { jid: '5551999990005@s.whatsapp.net', phone: '5551999990005', name: null },
  { jid: '5551999990099@s.whatsapp.net', phone: '5551999990099', name: 'Meu número', is_me: true },
];

test('detecta o "@" sendo digitado antes do cursor', () => {
  assert.deepEqual(findMentionTrigger('@', 1), { start: 0, query: '' });
  assert.deepEqual(findMentionTrigger('oi @ma', 6), { start: 3, query: 'ma' });
  assert.deepEqual(findMentionTrigger('oi @Maria Si', 12), { start: 3, query: 'Maria Si' });
  assert.deepEqual(findMentionTrigger('linha 1\n@jo', 11), { start: 8, query: 'jo' });
  // sem espaço antes do "@" (e-mail) não é menção
  assert.equal(findMentionTrigger('joao@empresa', 12), null);
  // cursor antes do "@": nada
  assert.equal(findMentionTrigger('oi @ma', 3), null);
  // texto comum longo depois do "@" deixa de ser busca
  assert.equal(findMentionTrigger('@' + 'a'.repeat(50), 51), null);
  assert.equal(findMentionTrigger('sem arroba', 10), null);
});

test('lista os participantes: nome sem acento, começo primeiro, telefone e sem o próprio número', () => {
  const names = (q: string) => filterMentionMembers(members, q).map(mentionLabel);
  assert.deepEqual(names(''), ['Maria Silva', 'João Pereira', 'Ana', 'Ana Paula', '5551999990005']); // sem "Meu número"
  assert.deepEqual(names('joao'), ['João Pereira']); // sem acento
  assert.deepEqual(names('ana'), ['Ana', 'Ana Paula']);
  assert.deepEqual(names('sil'), ['Maria Silva']); // começo de uma palavra do nome
  assert.deepEqual(names('0001'), ['Maria Silva']); // parte do telefone
  assert.deepEqual(names('zzz'), []);
  assert.equal(filterMentionMembers(members, '', 2).length, 2); // limite
});

test('no envio, "@Nome" vira "@número" e a pessoa entra na lista de menções', () => {
  const maria = { token: '@Maria Silva', jid: '5551999990001@s.whatsapp.net' };
  const r = applyMentions('Oi @Maria Silva, pode ver isso?', [maria]);
  assert.equal(r.text, 'Oi @5551999990001, pode ver isso?');
  assert.deepEqual(r.mentions, ['5551999990001@s.whatsapp.net']);
});

test('várias pessoas, a mesma pessoa duas vezes e menção editada ou apagada', () => {
  const maria = { token: '@Maria Silva', jid: '5551999990001@s.whatsapp.net' };
  const joao = { token: '@João Pereira', jid: '5551999990002@s.whatsapp.net' };
  const dois = applyMentions('@Maria Silva e @João Pereira, vejam. @Maria Silva?', [maria, joao]);
  assert.equal(dois.text, '@5551999990001 e @5551999990002, vejam. @Maria Silva?'); // cada escolha vale uma vez
  assert.deepEqual([...dois.mentions].sort(), [maria.jid, joao.jid].sort()); // a ordem da lista não importa

  // o texto da menção foi editado depois de escolher: não vale e fica como texto comum
  const editado = applyMentions('Oi @Maria S, tudo bem', [maria]);
  assert.equal(editado.text, 'Oi @Maria S, tudo bem');
  assert.deepEqual(editado.mentions, []);

  // menção apagada
  assert.deepEqual(applyMentions('sem ninguém', [maria]), { text: 'sem ninguém', mentions: [] });
});

test('nomes parecidos não se confundem ("@Ana" e "@Ana Paula") e nomes iguais seguem a ordem escolhida', () => {
  const ana = { token: '@Ana', jid: '5551999990003@s.whatsapp.net' };
  const anaPaula = { token: '@Ana Paula', jid: '5551999990004@s.whatsapp.net' };
  // escolhida primeiro a Ana, depois a Ana Paula: a Ana Paula não é engolida pela Ana
  const r = applyMentions('@Ana Paula e @Ana', [ana, anaPaula]);
  assert.equal(r.text, '@5551999990004 e @5551999990003');
  assert.deepEqual(r.mentions.sort(), [ana.jid, anaPaula.jid].sort());

  // duas pessoas com o mesmo nome: a primeira escolhida vale para a primeira ocorrência
  const a = { token: '@Carlos', jid: '5551999990010@s.whatsapp.net' };
  const b = { token: '@Carlos', jid: '5551999990011@s.whatsapp.net' };
  assert.equal(applyMentions('@Carlos e @Carlos', [a, b]).text, '@5551999990010 e @5551999990011');

  // "@Ana" dentro de uma palavra maior ("@Anabela") não conta
  assert.equal(applyMentions('oi @Anabela', [ana]).text, 'oi @Anabela');
});

test('identificadores de LID também viram menção', () => {
  const r = applyMentions('olá @Pedro!', [{ token: '@Pedro', jid: '121839833624806@lid' }]);
  assert.equal(r.text, 'olá @121839833624806!');
  assert.deepEqual(r.mentions, ['121839833624806@lid']);
});
