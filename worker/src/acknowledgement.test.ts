import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isAcknowledgement, matchIgnorePhrase } from './acknowledgement.js';

const PHRASES = ['obrigado pelo retorno doutora', 'fico no aguardo', 'Agradeço a atenção'];
const ack = (body: string) => isAcknowledgement('text', body, PHRASES);

test('frases cadastradas são ignoradas, com variações de escrita', () => {
  assert.ok(ack('Obrigado pelo retorno, Doutora!'));
  assert.ok(ack('obrigado pelo retorno doutora 🙏'));
  assert.ok(ack('Fico no aguardo.'));
  assert.ok(ack('agradeco a atencao, valeu'));
  assert.equal(matchIgnorePhrase('Agradeço   a ATENÇÃO!!', PHRASES), 'Agradeço a atenção');
});

test('frase cadastrada com pedido ou pergunta não é ignorada', () => {
  assert.ok(!ack('Fico no aguardo, mas e o prazo?'));
  assert.ok(!ack('obrigado pelo retorno doutora, preciso da cópia do contrato'));
  assert.ok(!ack('não fico no aguardo nada, quero resposta hoje'));
});

test('lista padrão continua valendo sem frases cadastradas', () => {
  assert.ok(isAcknowledgement('text', 'Obrigado!'));
  assert.ok(isAcknowledgement('text', 'Recebi, obrigado!'));
  assert.ok(!isAcknowledgement('text', 'fico no aguardo'));
});

test('cópia do painel é idêntica à do worker', () => {
  const worker = readFileSync(new URL('./acknowledgement.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/src/lib/acknowledgement.ts', import.meta.url), 'utf8');
  assert.equal(web, worker, 'atualize web/src/lib/acknowledgement.ts com o mesmo conteúdo');
});
