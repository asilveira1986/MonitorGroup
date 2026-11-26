import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadName } from './download-name.ts';

const id = '3f2a9c1e-aaaa-bbbb-cccc-1234567890ab';
const doc = (body: string | null, path = 'emp/private/chat/msg.pdf') => downloadName({ type: 'document', body, id, path });

test('documento com legenda sem extensão: ganha a extensão do arquivo guardado (o caso do PDF que baixava sem .pdf)', () => {
  assert.equal(doc('Vê se agora foi'), 'Vê se agora foi.pdf');
  assert.equal(doc('Contrato v2.1', 'a/b/c.docx'), 'Contrato v2.1.docx');
});

test('documento sem legenda: o texto é o nome do arquivo e já traz a extensão, que não repete', () => {
  assert.equal(doc('Contrato Social.pdf'), 'Contrato Social.pdf');
  assert.equal(doc('CONTRATO.PDF'), 'CONTRATO.PDF');
  assert.equal(doc('planilha.xlsx', 'a/b/c.xlsx'), 'planilha.xlsx');
});

test('legenda com caracteres que o arquivo não aceita, quebra de linha, ponto no fim ou muito longa', () => {
  assert.equal(doc('Pedido: nº 12/2026?'), 'Pedido nº 12 2026.pdf');
  assert.equal(doc('Segue o contrato.\nQualquer dúvida, me avise.'), 'Segue o contrato. Qualquer dúvida, me avise.pdf');
  assert.equal(doc('Vê se agora foi...'), 'Vê se agora foi.pdf');
  const longo = doc('a'.repeat(200));
  assert.equal(longo, `${'a'.repeat(80)}.pdf`);
});

test('sem legenda ou só com símbolos: nome pelo tipo e pelo código da mensagem, com a extensão do arquivo', () => {
  assert.equal(doc(null), 'document-3f2a9c1e.pdf');
  assert.equal(doc('   '), 'document-3f2a9c1e.pdf');
  assert.equal(doc('???'), 'document-3f2a9c1e.pdf');
});

test('imagem, áudio e vídeo continuam com o nome pelo tipo (a legenda não vira nome)', () => {
  assert.equal(downloadName({ type: 'image', body: 'Olha isso', id, path: 'a/b.jpg' }), 'image-3f2a9c1e.jpg');
  assert.equal(downloadName({ type: 'audio', body: null, id, path: 'a/b.ogg' }), 'audio-3f2a9c1e.ogg');
});

test('caminho sem extensão: usa bin', () => {
  assert.equal(downloadName({ type: 'document', body: 'Arquivo', id, path: 'a/b/semextensao' }), 'Arquivo.bin');
});
