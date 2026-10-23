import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isAcknowledgement, isThanksAfterTeam, matchIgnorePhrase } from './acknowledgement.js';

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
  assert.ok(!isAcknowledgement('text', 'aguardo o envio do contrato'));
});

test('cópia do painel é idêntica à do worker', () => {
  const worker = readFileSync(new URL('./acknowledgement.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/src/lib/acknowledgement.ts', import.meta.url), 'utf8');
  assert.equal(web, worker, 'atualize web/src/lib/acknowledgement.ts com o mesmo conteúdo');
});

test('agradecimento retribuído, despedidas e cortesias são ignorados', () => {
  for (const m of [
    'Eu que agradeço!',
    'Qualquer dúvida só nos chamar',
    'Bom final de semana!',
    'Obrigada, bom final de semana para vocês',
    'Nós que agradecemos 🙏',
    'Igualmente!',
    'Obrigado, doutora!',
    'Até mais, boa semana',
    'Fico à disposição',
  ]) {
    assert.ok(isAcknowledgement('text', m), m);
  }
});

test('pedidos e perguntas continuam pedindo resposta', () => {
  for (const m of [
    'Bom dia, alguém pode me ajudar?',
    'Doutora, preciso da cópia do contrato',
    'Qualquer dúvida sobre o processo eu pergunto',
    'Até amanhã envio os documentos',
    'Boa tarde, o boleto não chegou',
    'Eu que agradeço, mas e a audiência de amanhã?',
  ]) {
    assert.ok(!isAcknowledgement('text', m), m);
  }
});

test('agradecimento logo depois da equipe (isThanksAfterTeam)', () => {
  for (const ok of ['Combinado Alex! Obrigada!', 'Melhoras.', 'Perfeito, obrigado pela atenção Dra. Ana', 'Recebido, valeu Rafa 🙏', 'Ok, combinado então']) {
    assert.equal(isThanksAfterTeam('text', ok), true, ok);
  }
  for (const no of [
    'Obrigado, mas e o prazo?',
    'Obrigada! Preciso também da segunda via',
    'Ok, mas ainda não recebi',
    'Não recebi nada, obrigado',
    'Bom dia, tudo bem?',
    'Para fins de registro, informo que encaminhei o documento ao Micael',
  ]) {
    assert.equal(isThanksAfterTeam('text', no), false, no);
  }
  assert.equal(isThanksAfterTeam('image', 'obrigado'), false);
});
