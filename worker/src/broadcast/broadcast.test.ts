import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBroadcast } from './runner.js';
import { batchPauseMs, normalizeSettings, pickDelayMs, renderMessage, typingMs } from './service.js';
import type { BroadcastSettings, BroadcastSock, BroadcastStore, Campaign, Recipient } from './types.js';

// ------------------------------------------------------------------ regras puras

test('renderMessage troca as variáveis e limpa o que sobra', () => {
  assert.equal(renderMessage('Olá {primeiro_nome}, tudo bem?', { name: 'Maria da Silva' }), 'Olá Maria, tudo bem?');
  assert.equal(renderMessage('Olá {nome}!', { name: 'Maria da Silva' }), 'Olá Maria da Silva!');
  assert.equal(renderMessage('Aviso para {grupo}', { name: 'Clientes VIP' }), 'Aviso para Clientes VIP');
  // sem nome: a variável some e a pontuação gruda na palavra anterior
  assert.equal(renderMessage('Olá {nome}, tudo bem?', { name: null }), 'Olá, tudo bem?');
  assert.equal(renderMessage('  {NOME}  ', { name: 'Ana' }), 'Ana');
});

test('normalizeSettings aplica limites seguros', () => {
  const s = normalizeSettings({ broadcast_min_delay_s: 1, broadcast_max_delay_s: 0, broadcast_daily_limit: 'x' });
  assert.equal(s.minDelayS, 3);
  assert.equal(s.maxDelayS, 3);
  assert.equal(s.dailyLimit, 200);
  assert.deepEqual(normalizeSettings(null), { minDelayS: 8, maxDelayS: 25, batchSize: 40, batchPauseMin: 5, dailyLimit: 200 });
});

test('intervalos ficam dentro da faixa configurada', () => {
  const s: BroadcastSettings = { minDelayS: 10, maxDelayS: 20, batchSize: 10, batchPauseMin: 5, dailyLimit: 100 };
  assert.equal(pickDelayMs(s, () => 0), 10_000);
  assert.equal(pickDelayMs(s, () => 1), 20_000);
  assert.equal(batchPauseMs(s, () => 0), 300_000);
  assert.equal(batchPauseMs(s, () => 1), 360_000);
  assert.equal(typingMs('oi'), 1000);
  assert.equal(typingMs('x'.repeat(1000)), 4000);
});

// ------------------------------------------------------------------ envio com banco e WhatsApp simulados

const settings: BroadcastSettings = { minDelayS: 10, maxDelayS: 10, batchSize: 3, batchPauseMin: 5, dailyLimit: 5 };

function setup(opts: { recipients: Recipient[]; sentBefore?: number; sock?: Partial<BroadcastSock>; connected?: boolean; maxFails?: number }) {
  let clock = 1_000_000;
  const status = new Map<string, string>(opts.recipients.map((r) => [r.id, 'pending']));
  const errors = new Map<string, string>();
  const calls: { jid: string; text: string }[] = [];
  const events: string[] = [];
  const campaign: Campaign = { id: 'c1', companyId: 'co', name: 'Teste', target: 'groups', message: 'Oi {primeiro_nome}' };
  let campaignStatus = 'running';
  let sent = opts.sentBefore ?? 0;

  const store: BroadcastStore = {
    async startDue() {},
    async listRunning() {
      return campaignStatus === 'running' ? [campaign] : [];
    },
    async getSettings() {
      return settings;
    },
    async listPending(_c, limit) {
      return opts.recipients.filter((r) => status.get(r.id) === 'pending').slice(0, limit);
    },
    async claim(id) {
      if (status.get(id) !== 'pending') return false;
      status.set(id, 'sending');
      return true;
    },
    async markSent(id) {
      status.set(id, 'sent');
      sent++;
    },
    async markFailed(id, e) {
      status.set(id, 'failed');
      errors.set(id, e);
    },
    async countSent() {
      return sent;
    },
    async openCount() {
      return [...status.values()].filter((s) => s === 'pending' || s === 'sending').length;
    },
    async finish() {
      campaignStatus = 'done';
    },
    async pause() {
      campaignStatus = 'paused';
    },
    async failStuck() {
      return 0;
    },
  };
  const sock: BroadcastSock = {
    user: { id: 'me' },
    async sendMessage(jid, content) {
      calls.push({ jid, text: content.text });
      return {};
    },
    ...opts.sock,
  };
  const svc = createBroadcast({
    store,
    getSock: () => (opts.connected === false ? undefined : sock),
    generateId: () => `id${calls.length + 1}`,
    onSending: (id) => events.push(`bot:${id}`),
    logger: { info() {}, warn() {} },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    rand: () => 0,
    maxConsecutiveFailures: opts.maxFails,
  });
  return { svc, status, errors, calls, events, advance: (ms: number) => (clock += ms), campaignStatus: () => campaignStatus };
}

const group = (n: number): Recipient => ({ id: `r${n}`, campaignId: 'c1', kind: 'group', name: `Grupo ${n}`, phone: null, jid: `${n}@g.us`, instanceId: 'i1' });

test('envia uma mensagem por ciclo e respeita o intervalo entre elas', async () => {
  const t = setup({ recipients: [group(1), group(2)] });
  await t.svc.tick();
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0]!.text, 'Oi Grupo');
  assert.deepEqual(t.events, ['bot:id1']); // o id é registrado antes do envio
  await t.svc.tick(); // ainda dentro dos 10 s
  assert.equal(t.calls.length, 1);
  t.advance(10_000);
  await t.svc.tick();
  assert.equal(t.calls.length, 2);
  await t.svc.tick();
  assert.equal(t.campaignStatus(), 'done');
});

test('não envia com o WhatsApp desconectado e não perde ninguém', async () => {
  const t = setup({ recipients: [group(1)], connected: false });
  await t.svc.tick();
  assert.equal(t.calls.length, 0);
  assert.equal(t.status.get('r1'), 'pending');
  assert.equal(t.campaignStatus(), 'running');
});

test('o limite de 24 horas segura o envio', async () => {
  const t = setup({ recipients: [group(1)], sentBefore: 5 });
  await t.svc.tick();
  assert.equal(t.calls.length, 0);
  assert.equal(t.status.get('r1'), 'pending');
});

test('pausa longa depois de um lote', async () => {
  const t = setup({ recipients: [1, 2, 3, 4].map(group) });
  for (let i = 0; i < 3; i++) {
    await t.svc.tick();
    t.advance(10_000);
  }
  assert.equal(t.calls.length, 3);
  await t.svc.tick(); // fim do lote (3): pausa de 5 min
  assert.equal(t.calls.length, 3);
  t.advance(5 * 60_000);
  await t.svc.tick();
  assert.equal(t.calls.length, 4);
});

test('pessoa sem WhatsApp falha só ela e não pausa a campanha', async () => {
  const person = (n: number): Recipient => ({ id: `p${n}`, campaignId: 'c1', kind: 'person', name: `Pessoa ${n}`, phone: `55119999000${n}`, jid: null, instanceId: 'i1' });
  const t = setup({
    recipients: [person(1), person(2)],
    maxFails: 1,
    sock: {
      async onWhatsApp(phone) {
        return [{ jid: `${phone}@s.whatsapp.net`, exists: phone.endsWith('2') }];
      },
    },
  });
  await t.svc.tick();
  assert.equal(t.status.get('p1'), 'failed');
  assert.equal(t.errors.get('p1'), 'Este número não tem WhatsApp.');
  assert.equal(t.campaignStatus(), 'running');
  t.advance(10_000);
  await t.svc.tick();
  assert.equal(t.status.get('p2'), 'sent');
  assert.equal(t.calls[0]!.jid, '551199990002@s.whatsapp.net');
});

test('falhas seguidas de envio pausam a campanha', async () => {
  const t = setup({
    recipients: [1, 2, 3].map(group),
    maxFails: 2,
    sock: {
      async sendMessage() {
        throw new Error('Connection Closed');
      },
    },
  });
  await t.svc.tick();
  t.advance(10_000);
  await t.svc.tick();
  assert.equal(t.campaignStatus(), 'paused');
  assert.equal(t.status.get('r3'), 'pending'); // o resto continua na fila para quando retomar
});
