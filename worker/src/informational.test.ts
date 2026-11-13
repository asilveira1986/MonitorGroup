import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInformational } from './informational.js';

test('informe do cliente, sem pedir nada: não pede resposta', () => {
  assert.equal(isInformational('text', 'Sobre DET, defesa Matriz, Jovem Aprendiz, sem movimentação, Escritório esta acompanhando...'), true);
  assert.equal(isInformational('text', 'Estamos acompanhando.'), true);
  assert.equal(isInformational('text', 'Ciente, obrigado'), true);
  assert.equal(isInformational('text', 'Apenas informando que o processo segue sem novidades'), true);
});

test('pergunta, pedido, prazo ou problema: continua pedindo resposta', () => {
  assert.equal(isInformational('text', 'Sem movimentação, pode verificar?'), false);
  assert.equal(isInformational('text', 'Sem novidades. Preciso do relatório até sexta'), false);
  assert.equal(isInformational('text', 'Sem movimentação no processo, quando teremos retorno'), false);
  assert.equal(isInformational('text', 'Estamos acompanhando mas o prazo vence amanhã'), false);
  assert.equal(isInformational('text', 'Ciente, mas não recebi o documento'), false);
});

test('sem marcador de informe, arquivo ou texto muito longo: não vale', () => {
  assert.equal(isInformational('text', 'Bom dia, tudo bem'), false);
  assert.equal(isInformational('text', 'O processo foi arquivado'), false);
  assert.equal(isInformational('image', 'sem movimentação'), false);
  assert.equal(isInformational('text', null), false);
  assert.equal(isInformational('text', `sem movimentação ${'x '.repeat(400)}`), false);
});

test('o próprio cliente avisa que vai retornar: a bola está com ele', () => {
  assert.equal(
    isInformational(
      'text',
      '*Nicholas Matos:*\nBom dia pessoal!\nTivemos uma pendência no protocolo do Livro, eles solicitaram para que fosse alterada a centralização do documento, acabei de abrir um chamada na Junta Comercial questionando. Logo dou retorno sobre a resolução do protocolo!',
    ),
    true,
  );
  assert.equal(isInformational('text', 'Estou vendo isso com o setor, te retorno em breve'), true);
  // pedido junto: continua pedindo resposta
  assert.equal(isInformational('text', 'Logo dou retorno, mas preciso do contrato'), false);
  assert.equal(isInformational('text', 'Dou retorno amanhã. Pode confirmar o prazo?'), false);
});
