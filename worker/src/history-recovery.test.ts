import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runHistoryRecovery, type Cursor, type Page, type RecoveryDeps, type RecoveryProgress } from './history-recovery.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const cur = (id: string, daysAgo: number): Cursor => ({ id, fromMe: false, participant: 'x@s.whatsapp.net', at: NOW - daysAgo * DAY });

function setup(pages: (Page | null)[], over: Partial<RecoveryDeps> = {}) {
  const calls: Cursor[] = [];
  const progress: RecoveryProgress[] = [];
  const sleeps: number[] = [];
  let i = 0;
  let cancelled = false;
  const deps: RecoveryDeps = {
    sinceMs: NOW - 7 * DAY,
    anchor: async () => cur('newest', 0),
    fetchPage: async (c) => {
      calls.push(c);
      // null na lista = o celular não respondeu; acabou a lista = não há mais mensagens
      return i < pages.length ? pages[i++] : { found: 0, added: 0, oldest: null };
    },
    progress: async (p) => void progress.push(p),
    isCancelled: async () => cancelled,
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  };
  return { deps, calls, progress, sleeps, cancel: () => (cancelled = true) };
}

test('sem mensagem guardada no grupo: falha com o motivo, sem pedir nada', async () => {
  const t = setup([], { anchor: async () => null });
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'failed');
  assert.match(r.note, /nenhuma mensagem guardada/);
  assert.equal(t.calls.length, 0);
});

test('volta página por página, usando a mais antiga de cada uma como nova âncora, até o início do período', async () => {
  const t = setup([
    { found: 50, added: 40, oldest: cur('p1', 2) },
    { found: 50, added: 50, oldest: cur('p2', 5) },
    { found: 30, added: 30, oldest: cur('p3', 8) }, // passou do início (7 dias): termina
  ]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.match(r.note, /início do período/);
  assert.deepEqual(t.calls.map((c) => c.id), ['newest', 'p1', 'p2']);
  assert.equal(r.requests, 3);
  assert.equal(r.found, 130);
  assert.equal(r.added, 120);
  assert.equal(r.oldestAt, NOW - 8 * DAY);
  // andamento depois de cada página, e pausa entre os pedidos (não depois do último)
  assert.equal(t.progress.length, 3);
  assert.deepEqual(t.sleeps, [3000, 3000]);
});

test('o celular não tem mais nada: termina bem', async () => {
  const t = setup([{ found: 12, added: 12, oldest: cur('p1', 1) }, { found: 0, added: 0, oldest: null }]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.match(r.note, /não tem mensagens mais antigas/);
  assert.equal(r.added, 12);
});

test('o celular devolve só mensagens que não são mais antigas que a âncora: para (sem laço infinito)', async () => {
  const t = setup([{ found: 5, added: 0, oldest: cur('mesma', 0) }]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.match(r.note, /não devolveu mensagens mais antigas/);
  assert.equal(r.requests, 1);
});

test('celular sem responder desde o início: falha com o motivo e tenta duas vezes', async () => {
  const t = setup([null, null]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'failed');
  assert.match(r.note, /celular não respondeu/);
  assert.equal(r.requests, 2);
  assert.equal(r.added, 0);
  assert.equal(r.noReply, true); // quem processa vários grupos usa isto para parar de insistir
});

test('uma falha isolada do celular não derruba: tenta de novo a mesma página', async () => {
  const t = setup([null, { found: 50, added: 50, oldest: cur('p1', 8) }]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.deepEqual(t.calls.map((c) => c.id), ['newest', 'newest']);
  assert.equal(r.added, 50);
});

test('celular para de responder no meio: conclui com o que veio, sem falhar', async () => {
  const t = setup([{ found: 50, added: 30, oldest: cur('p1', 2) }, null, null]);
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.match(r.note, /parou de responder/);
  assert.equal(r.added, 30);
  assert.equal(r.noReply, undefined, 'veio alguma coisa: não é celular mudo');
});

test('cancelado no meio: para antes do próximo pedido', async () => {
  const t = setup([{ found: 50, added: 50, oldest: cur('p1', 2) }, { found: 50, added: 50, oldest: cur('p2', 3) }]);
  t.deps.progress = async (p) => {
    t.progress.push(p);
    t.cancel(); // o administrador cancela depois da 1ª página
  };
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'cancelled');
  assert.equal(r.requests, 1);
  assert.equal(t.calls.length, 1);
});

test('limite de pedidos por execução: termina dizendo para pedir de novo', async () => {
  let n = 0;
  const t = setup([], {
    maxPages: 3,
    fetchPage: async () => ({ found: 50, added: 10, oldest: cur('p' + ++n, n) }),
  });
  const r = await runHistoryRecovery(t.deps);
  assert.equal(r.status, 'done');
  assert.match(r.note, /limite de 3 pedidos/);
  assert.equal(r.requests, 3);
  assert.equal(r.added, 30);
});

test('pausa entre pedidos configurável', async () => {
  const t = setup([{ found: 1, added: 1, oldest: cur('p1', 1) }, { found: 0, added: 0, oldest: null }], { delayMs: 1234 });
  await runHistoryRecovery(t.deps);
  assert.deepEqual(t.sleeps, [1234]);
});
