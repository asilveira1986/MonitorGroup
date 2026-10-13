import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_COMMITMENT_VERBS, findCommitment } from './commitment.js';

const PHRASES = ['te retorno', 'retorno em seguida', 'dar uma olhada', 'prazo'];
const hit = (text: string) => findCommitment(text, DEFAULT_COMMITMENT_VERBS, PHRASES)?.trigger ?? null;

test('reconhece compromissos em várias formas', () => {
  const cases: [string, string][] = [
    ['Irei verificar e te retorno', 'irei verificar'],
    ['Vou realizar o ajuste hoje', 'vou realizar'],
    ['vou corrigir', 'vou corrigir'],
    ['Vamos já te enviar o boleto', 'vamos ja te enviar'],
    ['Já estou verificando aqui', 'estou verificando'],
    ['Estamos ajustando o cadastro', 'estamos ajustando'],
    ['Verificarei com o financeiro', 'verificarei'],
    ['Corrigiremos ainda hoje', 'corrigiremos'],
    ['Pode deixar que eu corrijo', 'eu corrijo'],
    ['Já faço isso', 'ja faco'],
    ['A gente vai sim providenciar', 'vai sim providenciar'],
    ['Fico de enviar amanhã', 'fico de enviar'],
    ['tô resolvendo', 'to resolvendo'],
    ['Deixa eu dar uma olhada', 'dar uma olhada'],
    ['Ok, te retorno em breve', 'te retorno'],
  ];
  for (const [text, trigger] of cases) assert.equal(hit(text), trigger, text);
});

test('ignora negação e mensagens sem compromisso', () => {
  for (const text of [
    'Não vou conseguir verificar hoje',
    'não irei corrigir isso',
    'Bom dia, tudo bem?',
    'O sistema foi corrigido ontem',
    'Obrigado pelo retorno',
    'verificado',
  ]) {
    assert.equal(hit(text), null, text);
  }
  // pontuação separa a negação da promessa
  assert.equal(hit('Não, vou verificar agora'), 'vou verificar');
});

test('sem verbos nem frases não reconhece nada', () => {
  assert.equal(findCommitment('vou verificar', [], []), null);
  assert.deepEqual(findCommitment('vou verificar', ['verificar'], []), { trigger: 'vou verificar', kind: 'verb' });
});

test('a cópia do painel é igual à do worker', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(read('../../web/src/lib/commitment.ts'), read('./commitment.ts'));
});
