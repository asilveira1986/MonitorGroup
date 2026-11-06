import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBroadcast } from './runner.js';
import { batchPauseMs, inSendWindow, isOptOutText, normalizeSettings, OPTOUT_FOOTER, pickDelayMs, pickVariant, renderMessage, typingMs, withOptOutFooter } from './service.js';
import { phoneKey } from './store.js';
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

function setup(opts: {
  recipients: Recipient[];
  sentBefore?: number;
  sock?: Partial<BroadcastSock>;
  connected?: boolean;
  maxFails?: number;
  campaign?: Partial<Campaign>;
  optedOut?: string[];
  start?: number;
  timezone?: string;
}) {
  let clock = opts.start ?? 1_000_000;
  const mediaLoads: string[] = [];
  const status = new Map<string, string>(opts.recipients.map((r) => [r.id, 'pending']));
  const errors = new Map<string, string>();
  const calls: { jid: string; text: string; content: Record<string, unknown> }[] = [];
  const events: string[] = [];
  const campaign: Campaign = {
    id: 'c1',
    companyId: 'co',
    name: 'Teste',
    target: 'groups',
    message: 'Oi {primeiro_nome}',
    variants: [],
    media: null,
    window: null,
    optoutFooter: false,
    ...opts.campaign,
  };
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
    async isOptedOut(_c, phone) {
      return (opts.optedOut ?? []).includes(phone);
    },
    async markSkipped(id, reason) {
      status.set(id, 'skipped');
      errors.set(id, reason);
    },
    async loadMedia(path) {
      mediaLoads.push(path);
      return Buffer.from('arquivo');
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
      calls.push({ jid, text: String(content.text ?? content.caption ?? ''), content });
      return {};
    },
    ...opts.sock,
  };
  const svc = createBroadcast({
    store,
    getSock: () => (opts.connected === false ? undefined : sock),
    generateId: () => `id${calls.length + 1}`,
    onSending: (id) => events.push(`bot:${id}`),
    buildMedia: async (media, buffer, caption) => ({ [media.type]: buffer, caption, mimetype: media.mime }),
    getTimezone: async () => opts.timezone ?? 'America/Sao_Paulo',
    logger: { info() {}, warn() {} },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    rand: () => 0,
    maxConsecutiveFailures: opts.maxFails,
  });
  return { svc, status, errors, calls, events, mediaLoads, advance: (ms: number) => (clock += ms), campaignStatus: () => campaignStatus };
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

// ------------------------------------------------------------------ fase 2

test('variações: estáveis por destinatário e todas aparecem', () => {
  assert.equal(pickVariant(['a'], 'x'), 'a');
  assert.equal(pickVariant([], 'x'), '');
  assert.equal(pickVariant(['a', 'b', 'c'], 'id-1'), pickVariant(['a', 'b', 'c'], 'id-1'));
  const seen = new Set(Array.from({ length: 60 }, (_, i) => pickVariant(['a', 'b', 'c'], `recipient-${i}`)));
  assert.equal(seen.size, 3);
});

test('pedido de saída: só a palavra sozinha', () => {
  for (const ok of ['SAIR', ' sair ', 'Sair.', 'PARAR!', 'stop', 'Não quero receber', 'descadastrar']) assert.equal(isOptOutText(ok), true, ok);
  for (const no of ['não quero sair do plano', 'preciso sair mais cedo', 'ok', '', null, 'pare de ligar para mim hoje']) assert.equal(isOptOutText(no as string | null), false, String(no));
});

test('rodapé de saída', () => {
  assert.equal(withOptOutFooter('Oi'), `Oi\n\n${OPTOUT_FOOTER}`);
  assert.equal(withOptOutFooter(''), OPTOUT_FOOTER);
});

test('chave de telefone ignora o 55 e o 9º dígito', () => {
  assert.equal(phoneKey('5511999990001'), phoneKey('1199990001'));
  assert.equal(phoneKey('5511999990001'), phoneKey('(11) 99999-0001'));
  assert.notEqual(phoneKey('5511999990001'), phoneKey('5511999990002'));
});

test('janela de horário: dias e horas no fuso da empresa', () => {
  const w = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };
  assert.equal(inSendWindow(null, new Date(), 'America/Sao_Paulo'), true);
  assert.equal(inSendWindow(w, new Date('2026-11-04T15:00:00Z'), 'America/Sao_Paulo'), true); // quarta 12:00
  assert.equal(inSendWindow(w, new Date('2026-11-04T23:30:00Z'), 'America/Sao_Paulo'), false); // quarta 20:30
  assert.equal(inSendWindow(w, new Date('2026-11-07T15:00:00Z'), 'America/Sao_Paulo'), false); // sábado
});

test('fora da janela nada é enviado e a campanha segue aberta', async () => {
  const t = setup({
    recipients: [group(1)],
    campaign: { window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' } },
    start: new Date('2026-11-04T23:30:00Z').getTime(),
  });
  await t.svc.tick();
  assert.equal(t.calls.length, 0);
  assert.equal(t.status.get('r1'), 'pending');
  assert.equal(t.campaignStatus(), 'running');
});

test('dentro da janela envia normalmente', async () => {
  const t = setup({
    recipients: [group(1)],
    campaign: { window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' } },
    start: new Date('2026-11-04T15:00:00Z').getTime(),
  });
  await t.svc.tick();
  assert.equal(t.calls.length, 1);
});

const person = (n: number): Recipient => ({ id: `p${n}`, campaignId: 'c1', kind: 'person', name: `Pessoa ${n}`, phone: `55119999000${n}`, jid: null, instanceId: 'i1' });
const exists = { async onWhatsApp(phone: string) { return [{ jid: `${phone}@s.whatsapp.net`, exists: true }]; } };

test('opt-out: quem pediu para sair não recebe, sem contar como falha nem pausar', async () => {
  const t = setup({ recipients: [person(1), person(2)], optedOut: ['551199990001'], sock: exists, maxFails: 1 });
  await t.svc.tick();
  assert.equal(t.status.get('p1'), 'skipped');
  assert.equal(t.errors.get('p1'), 'Pediu para não receber mensagens.');
  // pular quem saiu não gasta o intervalo: o próximo da fila segue no mesmo ciclo
  assert.equal(t.status.get('p2'), 'sent');
  assert.equal(t.calls.length, 1);
  assert.equal(t.campaignStatus(), 'done'); // não foi falha: não pausou
});

test('rodapé de saída só nas mensagens a pessoas', async () => {
  const p = setup({ recipients: [person(1)], sock: exists, campaign: { target: 'people', message: 'Oi {primeiro_nome}', optoutFooter: true } });
  await p.svc.tick();
  assert.equal(p.calls[0]!.text, `Oi Pessoa\n\n${OPTOUT_FOOTER}`);
  const g = setup({ recipients: [group(1)], campaign: { optoutFooter: true } });
  await g.svc.tick();
  assert.equal(g.calls[0]!.text, 'Oi Grupo');
});

test('arquivo: baixa uma vez só e usa o texto como legenda', async () => {
  const t = setup({
    recipients: [group(1), group(2)],
    campaign: { message: 'Veja {grupo}', media: { path: 'co/broadcast/a.png', type: 'image', mime: 'image/png', name: 'a.png' } },
  });
  await t.svc.tick();
  t.advance(10_000);
  await t.svc.tick();
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0]!.text, 'Veja Grupo 1');
  assert.ok(Buffer.isBuffer(t.calls[0]!.content.image));
  assert.deepEqual(t.mediaLoads, ['co/broadcast/a.png']);
});

test('arquivo sem texto: legenda vazia e áudio nunca leva texto nem rodapé', async () => {
  const doc = setup({ recipients: [group(1)], campaign: { message: '', media: { path: 'p', type: 'document', mime: 'application/pdf', name: 'a.pdf' } } });
  await doc.svc.tick();
  assert.equal(doc.calls.length, 1);
  assert.equal(doc.calls[0]!.text, '');
  const audio = setup({
    recipients: [person(1)],
    sock: exists,
    campaign: { target: 'people', message: 'texto ignorado', optoutFooter: true, media: { path: 'p', type: 'audio', mime: 'audio/ogg', name: null } },
  });
  await audio.svc.tick();
  assert.equal(audio.calls[0]!.text, '');
});

test('variações: cada destinatário recebe uma das opções', async () => {
  const t = setup({ recipients: [1, 2, 3].map(group), campaign: { message: 'A', variants: ['B', 'C'] } });
  for (let i = 0; i < 3; i++) {
    await t.svc.tick();
    t.advance(10_000);
  }
  assert.equal(t.calls.length, 3);
  assert.ok(t.calls.every((c) => ['A', 'B', 'C'].includes(c.text)));
});
