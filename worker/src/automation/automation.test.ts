import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatWait } from '../duration.js';
import { isBusinessHours } from './hours.js';
import { createSender } from './sender.js';
import {
  createAutomation,
  createBotRegistry,
  escalationText,
  messagePreview,
  stepFor,
  waitMinutesFor,
  type AutomationMessage,
} from './service.js';
import type { AlertInput, AutomationRule, AutomationStore, LogAction, NewPending, OpenPending, PendingReply, SockLike } from './types.js';

// ------------------------------------------------------------------ simulações

const INSIDE = new Date('2026-11-04T15:00:00Z'); // quarta, 12:00 em São Paulo
const NIGHT = new Date('2026-11-04T23:30:00Z'); // quarta, 20:30 em São Paulo (fora do expediente)
const min = (n: number) => n * 60_000;

const baseRule: AutomationRule = {
  groupId: 'g1',
  companyId: 'c1',
  enabled: true,
  ackEnabled: true,
  ackMessage: 'ACK DENTRO',
  ackOffHours: 'ACK FORA',
  ackCooldownMin: 30,
  ackDelaySec: 0,
  lastAckAt: null,
  notifyGroupJid: 'interno@g.us',
  notifyGroupName: 'Trabalhista',
  escalateAfterMin: 15,
  repeatEveryMin: 30,
  maxEscalations: 3,
  escalateOffHours: false,
  mentionJids: ['5551999990001@s.whatsapp.net', '5551999990002@s.whatsapp.net'],
  escalationSteps: [],
  businessDays: [1, 2, 3, 4, 5],
  businessStart: '08:00',
  businessEnd: '18:00',
};

type Sent = { instanceId: string; jid: string; text: string; mentions?: string[]; quoted?: unknown; typing?: boolean };

function setup(ruleOverrides: Partial<AutomationRule> = {}, start: Date = INSIDE) {
  let current = start;
  const rule: AutomationRule = { ...baseRule, ...ruleOverrides };
  const pendings: (PendingReply & { resolvedAt?: Date; resolvedBy?: string; responseSec?: number })[] = [];
  const alerts: (AlertInput & { id: string; status: string })[] = [];
  const updates: { id: string; description: string }[] = [];
  const resolvedAlertsOf: string[] = [];
  const logs: { action: LogAction; detail: string | null }[] = [];
  const sent: Sent[] = [];
  const logsOut: { level: string; msg?: string }[] = [];
  let groupStillPending = true;
  let enabled = true;
  let failSend: ((req: Sent) => boolean) | null = null;
  let ids = 0;
  // responsáveis do grupo e do setor (0158)
  let responsibles: { group: string[]; sector: string[] } = { group: [], sector: [] };
  let failResponsibles = false;
  // acuses com espera (0159): o relógio é manual
  const scheduled: { fn: () => void; ms: number }[] = [];

  const store: AutomationStore = {
    async isEnabled() {
      return enabled;
    },
    async getRule(groupId) {
      return groupId === rule.groupId ? { ...rule } : null;
    },
    async resolveResponsibles() {
      if (failResponsibles) throw new Error('falha simulada ao buscar os responsáveis');
      return responsibles;
    },
    async listNotifyJids() {
      return [rule.notifyGroupJid];
    },
    async getOpenPending(groupId) {
      return pendings.find((p) => p.groupId === groupId && !p.resolvedAt) ?? null;
    },
    async createPending(p: NewPending) {
      if (pendings.some((x) => x.groupId === p.groupId && !x.resolvedAt)) return null;
      const row = { ...p, id: `p${++ids}`, escalationCount: 0, lastEscalatedAt: null, alertId: null };
      pendings.push(row);
      return row;
    },
    async bumpPending(id, preview, messageCount) {
      Object.assign(pendings.find((p) => p.id === id)!, { preview, messageCount });
    },
    async setPendingAlert(id, alertId) {
      pendings.find((p) => p.id === id)!.alertId = alertId;
    },
    async markEscalated(id, count, at) {
      Object.assign(pendings.find((p) => p.id === id)!, { escalationCount: count, lastEscalatedAt: at });
    },
    async resolvePending(id, by, responseSec, at) {
      Object.assign(pendings.find((p) => p.id === id)!, { resolvedAt: at, resolvedBy: by, responseSec });
    },
    async listOpenPending(): Promise<OpenPending[]> {
      return pendings.filter((p) => !p.resolvedAt).map((pending) => ({ pending, rule: { ...rule }, groupStillPending }));
    },
    async createAlert(a) {
      const id = `a${++ids}`;
      alerts.push({ ...a, id, status: 'open' });
      return id;
    },
    async updateAlert(id, patch) {
      updates.push({ id, description: patch.description });
    },
    async resolveAlerts(groupId) {
      resolvedAlertsOf.push(groupId);
      for (const a of alerts) if (a.groupId === groupId) a.status = 'resolved';
    },
    async setLastAck(_groupId, at) {
      rule.lastAckAt = at;
    },
    async log(_company, _group, action, detail) {
      logs.push({ action, detail });
    },
  };

  const bots = createBotRegistry(15 * 60_000, () => current.getTime());
  const sender = {
    async send(req: Sent) {
      if (failSend?.(req)) throw new Error('falha simulada no envio');
      sent.push(req);
      const id = `BOT${sent.length}`;
      bots.mark(id);
      return id;
    },
  };
  const logger = {
    info: (_o: object | string, msg?: string) => void logsOut.push({ level: 'info', msg: typeof _o === 'string' ? _o : msg }),
    warn: (_o: object | string, msg?: string) => void logsOut.push({ level: 'warn', msg: typeof _o === 'string' ? _o : msg }),
    error: (_o: object | string, msg?: string) => void logsOut.push({ level: 'error', msg: typeof _o === 'string' ? _o : msg }),
  };
  const automation = createAutomation({
    store,
    sender,
    bots,
    logger,
    panelUrl: 'https://painel.exemplo.com/',
    now: () => current,
    ruleCacheMs: 0,
    checkIntervalMs: 60_000,
    schedule: (fn, ms) => void scheduled.push({ fn, ms }),
  });

  const client = (over: Partial<AutomationMessage> = {}): AutomationMessage => ({
    companyId: 'c1',
    instanceId: 'i1',
    group: { id: 'g1', jid: 'cliente@g.us', name: 'Cliente Alfa' },
    waMessageId: `W${++ids}`,
    messageId: `m${ids}`,
    fromTeam: false,
    senderName: 'Maria',
    text: 'preciso de ajuda',
    sentAt: current,
    opensPending: true,
    isNotify: true,
    quoted: { key: { id: 'original' } },
    ...over,
  });
  const team = (over: Partial<AutomationMessage> = {}) => client({ fromTeam: true, senderName: 'Carla', text: 'já resolvo', ...over });

  return {
    automation,
    client,
    team,
    store,
    bots,
    pendings,
    alerts,
    updates,
    resolvedAlertsOf,
    logs,
    sent,
    logsOut,
    setNow: (d: Date) => (current = d),
    advance: (ms: number) => (current = new Date(current.getTime() + ms)),
    setGroupStillPending: (v: boolean) => (groupStillPending = v),
    setEnabled: (v: boolean) => (enabled = v),
    failSends: (fn: ((req: Sent) => boolean) | null) => (failSend = fn),
    scheduled,
    runScheduled: async () => {
      for (const s of scheduled.splice(0)) s.fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    setResponsibles: (v: { group: string[]; sector: string[] }) => (responsibles = v),
    failResponsiblesLookup: (v: boolean) => (failResponsibles = v),
  };
}

// ------------------------------------------------------------------ cenários da automação

test('mensagem de cliente: 1 acuse no grupo, 1 aviso no grupo interno, alerta warning e 1 demanda', async () => {
  const t = setup();
  const m = t.client();
  await t.automation.handleMessage(m);

  assert.equal(t.sent.length, 2);
  // acuse no próprio grupo, citando a mensagem do cliente, com "digitando…"
  assert.equal(t.sent[0].jid, 'cliente@g.us');
  assert.equal(t.sent[0].text, 'ACK DENTRO');
  assert.equal(t.sent[0].quoted, m.quoted);
  assert.equal(t.sent[0].typing, true);
  // aviso no grupo interno, com o nome do grupo, o cliente, o trecho e o link do painel
  assert.equal(t.sent[1].jid, 'interno@g.us');
  for (const part of ['Cliente Alfa', 'Maria', 'preciso de ajuda', 'https://painel.exemplo.com/groups/g1']) {
    assert.ok(t.sent[1].text.includes(part), `o aviso deve conter "${part}"`);
  }
  // alerta em tela (alert:new, warning) e demanda aberta
  assert.equal(t.alerts.length, 1);
  assert.equal(t.alerts[0].type, 'new_message');
  assert.equal(t.alerts[0].severity, 'warning');
  assert.equal(t.pendings.length, 1);
  assert.equal(t.pendings[0].alertId, t.alerts[0].id);
  assert.deepEqual(t.logs.map((l) => l.action), ['ACK', 'NOTIFY']);
});

test('segunda mensagem com demanda aberta: nenhum envio novo, só atualiza o alerta', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  await t.automation.handleMessage(t.client({ text: 'alguém aí?' }));

  assert.equal(t.sent.length, 2); // nada novo
  assert.equal(t.alerts.length, 1); // sem novo alerta
  assert.equal(t.pendings.length, 1);
  assert.equal(t.pendings[0].messageCount, 2);
  assert.equal(t.updates.length, 1); // alert:update
  assert.equal(t.updates[0].id, t.alerts[0].id);
  assert.ok(t.updates[0].description.includes('2 mensagens'));
  assert.ok(t.updates[0].description.includes('alguém aí?'));
});

test('cobrança depois de escalateAfterMin: menciona a equipe, alerta critical e escalationCount = 1', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  t.advance(min(14));
  assert.equal(await t.automation.checkEscalations(), 0); // ainda não chegou na hora

  t.advance(min(2)); // 16 min
  assert.equal(await t.automation.checkEscalations(), 1);
  const cobranca = t.sent[2];
  assert.equal(cobranca.jid, 'interno@g.us');
  assert.ok(cobranca.text.startsWith('⏰🚨 SEM RESPOSTA há 16 min'));
  assert.ok(cobranca.text.includes('Cliente Alfa') && cobranca.text.includes('preciso de ajuda'));
  assert.deepEqual(cobranca.mentions, baseRule.mentionJids);
  assert.ok(cobranca.text.includes('@5551999990001') && cobranca.text.includes('@5551999990002'));
  const critical = t.alerts.at(-1)!;
  assert.equal(critical.type, 'no_reply');
  assert.equal(critical.severity, 'critical');
  assert.equal(t.pendings[0].escalationCount, 1);
  assert.equal(t.logs.at(-1)!.action, 'ESCALATE');
});

test('não passa de maxEscalations e respeita repeatEveryMin', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  const cobrancas = () => t.sent.filter((s) => s.text.startsWith('⏰🚨')).length;

  t.advance(min(16)); // 1ª cobrança
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 1);

  t.advance(min(20)); // 36 min: só 20 min desde a última (repeatEveryMin = 30)
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 1);

  t.advance(min(10)); // 46 min: 30 min desde a última
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 2);

  t.advance(min(30)); // 76 min: 3ª e última
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 3);
  assert.equal(t.pendings[0].escalationCount, 3);

  t.advance(min(300)); // passou de maxEscalations: nada mais
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 3);
  assert.equal(t.pendings[0].escalationCount, 3);
});

test('fora do horário: acuse ackOffHours e nenhuma cobrança; a cobrança sai quando o expediente abre', async () => {
  const t = setup({}, NIGHT);
  await t.automation.handleMessage(t.client());
  assert.equal(t.sent[0].text, 'ACK FORA');
  assert.equal(t.logs[0].action, 'ACK_OFFHOURS');

  t.advance(min(60)); // 21:30 em São Paulo: passou do prazo, mas é fora do expediente
  assert.equal(await t.automation.checkEscalations(), 0);
  assert.equal(t.sent.filter((s) => s.text.startsWith('⏰🚨')).length, 0);

  t.setNow(new Date('2026-11-05T10:59:00Z')); // quinta, 07:59: ainda fechado
  assert.equal(await t.automation.checkEscalations(), 0);
  t.setNow(new Date('2026-11-05T11:00:00Z')); // quinta, 08:00: expediente abriu
  assert.equal(await t.automation.checkEscalations(), 1);
  assert.ok(t.sent.at(-1)!.text.includes('SEM RESPOSTA há 11h30'));
});

test('escalateOffHours = true cobra também fora do horário', async () => {
  const t = setup({ escalateOffHours: true }, NIGHT);
  await t.automation.handleMessage(t.client());
  t.advance(min(16));
  assert.equal(await t.automation.checkEscalations(), 1);
});

test('resposta de membro da equipe encerra a demanda com responseSec e tira o alerta da tela', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  t.advance(min(5));
  await t.automation.handleMessage(t.team());

  assert.ok(t.pendings[0].resolvedAt);
  assert.equal(t.pendings[0].resolvedBy, 'Carla');
  assert.equal(t.pendings[0].responseSec, 300);
  assert.deepEqual(t.resolvedAlertsOf, ['g1']); // alert:resolved
  assert.equal(t.alerts[0].status, 'resolved');
  assert.equal(t.logs.at(-1)!.action, 'RESOLVED');
  // sem demanda aberta não há mais cobrança
  t.advance(min(60));
  assert.equal(await t.automation.checkEscalations(), 0);
});

test('o número conectado respondendo pelo celular (append) também encerra', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  t.advance(min(2));
  await t.automation.handleMessage(t.team({ isNotify: false, senderName: 'Número conectado' }));
  assert.equal(t.pendings[0].resolvedBy, 'Número conectado');
});

test('mensagem enviada pelo próprio bot (id registrado) não encerra a demanda', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  // o acuse e o aviso voltam pelo WhatsApp como mensagens do número conectado
  t.advance(min(1));
  await t.automation.handleMessage(t.team({ waMessageId: 'BOT1', senderName: 'Número conectado' }));
  await t.automation.handleMessage(t.team({ waMessageId: 'BOT2', senderName: 'Número conectado' }));
  assert.equal(t.pendings[0].resolvedAt, undefined);
  // uma resposta de verdade, depois, encerra
  await t.automation.handleMessage(t.team({ waMessageId: 'REAL1' }));
  assert.ok(t.pendings[0].resolvedAt);
});

test('mensagem no grupo interno é ignorada', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client({ group: { id: 'g2', jid: 'interno@g.us', name: 'Trabalhista' } }));
  await t.automation.handleMessage(t.team({ group: { id: 'g2', jid: 'interno@g.us', name: 'Trabalhista' } }));
  assert.equal(t.sent.length, 0);
  assert.equal(t.pendings.length, 0);
  assert.equal(t.alerts.length, 0);
});

test('histórico, agradecimento e grupo sem regra não disparam a automação', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client({ isNotify: false })); // histórico / sincronização
  await t.automation.handleMessage(t.client({ opensPending: false, text: 'obrigado!' })); // não abre pendência
  assert.equal(t.sent.length, 0);
  assert.equal(t.pendings.length, 0);

  const off = setup({ enabled: false });
  await off.automation.handleMessage(off.client());
  assert.equal(off.sent.length, 0);
  const none = setup();
  await none.automation.handleMessage(none.client({ group: { id: 'outro', jid: 'outro@g.us', name: 'Outro' } }));
  assert.equal(none.sent.length, 0);
});

test('o acuse não se repete dentro de ackCooldownMin, mas o aviso e a demanda seguem', async () => {
  const t = setup({ ackCooldownMin: 30 });
  await t.automation.handleMessage(t.client());
  t.advance(min(5));
  await t.automation.handleMessage(t.team()); // encerra a primeira
  t.advance(min(10));
  await t.automation.handleMessage(t.client({ text: 'outra dúvida' })); // 2ª demanda, 15 min depois do 1º acuse
  const acuses = () => t.sent.filter((s) => s.jid === 'cliente@g.us').length;
  assert.equal(acuses(), 1); // sem novo acuse
  assert.equal(t.sent.filter((s) => s.jid === 'interno@g.us').length, 2); // mas avisou de novo
  assert.equal(t.pendings.length, 2);

  t.advance(min(1));
  await t.automation.handleMessage(t.team({ waMessageId: 'R2' }));
  t.advance(min(30));
  await t.automation.handleMessage(t.client({ text: 'terceira' }));
  assert.equal(acuses(), 2); // passou o cooldown
});

test('acuse desligado: avisa o grupo interno e abre a demanda, sem responder no grupo do cliente', async () => {
  const t = setup({ ackEnabled: false });
  await t.automation.handleMessage(t.client());
  assert.deepEqual(t.sent.map((s) => s.jid), ['interno@g.us']);
  assert.equal(t.pendings.length, 1);
});

test('erro de envio é registrado e não derruba o processamento', async () => {
  const t = setup();
  t.failSends((req) => req.jid === 'cliente@g.us'); // o acuse falha
  await t.automation.handleMessage(t.client());
  assert.equal(t.sent.length, 1); // o aviso interno saiu
  assert.equal(t.pendings.length, 1);
  assert.ok(t.logsOut.some((l) => l.level === 'warn' && l.msg?.includes('acuse')));

  // a mensagem seguinte é processada normalmente
  await t.automation.handleMessage(t.client({ text: 'mais uma' }));
  assert.equal(t.pendings[0].messageCount, 2);

  // cobrança que falha não conta: tenta de novo na próxima verificação
  t.failSends(() => true);
  t.advance(min(16));
  assert.equal(await t.automation.checkEscalations(), 0);
  assert.equal(t.pendings[0].escalationCount, 0);
  t.failSends(null);
  assert.equal(await t.automation.checkEscalations(), 1);
  assert.equal(t.pendings[0].escalationCount, 1);
});

test('demanda respondida por outro caminho (Marcar como respondida) é encerrada pelo verificador', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  t.setGroupStillPending(false);
  t.advance(min(1)); // ainda dentro da tolerância da gravação
  await t.automation.checkEscalations();
  assert.equal(t.pendings[0].resolvedAt, undefined);

  t.advance(min(3));
  await t.automation.checkEscalations();
  assert.ok(t.pendings[0].resolvedAt);
  assert.equal(t.pendings[0].resolvedBy, 'sistema (grupo respondido)');
  assert.deepEqual(t.resolvedAlertsOf, ['g1']);
});

test('um reinício não perde cobranças: o estado está no banco', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  // novo serviço sobre o mesmo banco (como depois de reiniciar o worker)
  t.advance(min(20));
  const reiniciado = createAutomation({
    store: t.store,
    sender: { send: async (req) => (t.sent.push(req as never), 'X') },
    bots: createBotRegistry(),
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(INSIDE.getTime() + min(20)),
    ruleCacheMs: 0,
  });
  assert.equal(await reiniciado.checkEscalations(), 1);
});

test('sem o script do banco (0144): avisa uma vez no log e não lança nem erra a cada mensagem', async () => {
  const t = setup();
  const quebrado = new Error('Could not find the table \'public.automation_rules\' in the schema cache');
  t.store.getRule = async () => {
    throw quebrado;
  };
  t.store.listOpenPending = async () => {
    throw quebrado;
  };
  await t.automation.handleMessage(t.client());
  await t.automation.handleMessage(t.client());
  assert.equal(await t.automation.checkEscalations(), 0);
  const avisos = t.logsOut.filter((l) => l.msg?.includes('falta rodar o script do banco'));
  assert.equal(avisos.length, 1); // uma vez só
  assert.equal(t.logsOut.filter((l) => l.level === 'error').length, 0);
  assert.equal(t.sent.length, 0);
});

test('chave geral desligada: não responde, não avisa nem cobra; a resposta da equipe ainda encerra', async () => {
  const t = setup();
  t.setEnabled(false);
  await t.automation.handleMessage(t.client());
  assert.equal(t.sent.length, 0);
  assert.equal(t.pendings.length, 0);
  assert.equal(t.alerts.length, 0);

  // com demanda aberta (aberta antes de desligar), a cobrança fica parada e a resposta da equipe ainda encerra
  t.setEnabled(true);
  await t.automation.handleMessage(t.client());
  assert.equal(t.pendings.length, 1);
  t.setEnabled(false);
  t.advance(min(30));
  assert.equal(await t.automation.checkEscalations(), 0);
  assert.equal(t.sent.filter((s) => s.text.startsWith('⏰🚨')).length, 0);
  await t.automation.handleMessage(t.team());
  assert.ok(t.pendings[0].resolvedAt);
});

test('religar a chave geral volta a agir (depois que o cache de leitura vence)', async () => {
  const t = setup();
  t.setEnabled(false);
  await t.automation.handleMessage(t.client());
  assert.equal(t.pendings.length, 0);
  t.setEnabled(true);
  await t.automation.handleMessage(t.client({ text: 'agora sim' }));
  assert.equal(t.pendings.length, 1);
  assert.equal(t.sent.length, 2); // acuse + aviso
});

test('start() registra o verificador e stop() não deixa timers segurando o processo', () => {
  const t = setup();
  t.automation.start();
  assert.ok(t.logsOut.some((l) => l.msg === '[automation] verificador de cobranças iniciado'));
  t.automation.stop();
});

// ------------------------------------------------------------------ horário de atendimento

test('isBusinessHours: início vale, fim não, no fuso de São Paulo mesmo com o servidor em UTC', () => {
  const rule = { businessDays: [1, 2, 3, 4, 5], businessStart: '08:00', businessEnd: '18:00' };
  // São Paulo é UTC-3: 08:00 BRT = 11:00 UTC
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T10:59:59Z')), false); // 07:59:59
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T11:00:00Z')), true); // 08:00 (início vale)
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T20:59:59Z')), true); // 17:59:59
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T21:00:00Z')), false); // 18:00 (fim não vale)
  // fim de semana
  assert.equal(isBusinessHours(rule, new Date('2026-11-07T15:00:00Z')), false); // sábado, 12:00
  assert.equal(isBusinessHours(rule, new Date('2026-11-08T15:00:00Z')), false); // domingo, 12:00
  // a virada do dia: 02:30 UTC de quinta ainda é quarta à noite em São Paulo
  assert.equal(isBusinessHours(rule, new Date('2026-11-05T02:30:00Z')), false);
  // outro fuso, quando a empresa configura
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T11:00:00Z'), 'UTC'), true); // 11:00 UTC
  assert.equal(isBusinessHours(rule, new Date('2026-11-04T07:00:00Z'), 'UTC'), false);
});

// ------------------------------------------------------------------ envio

test('sender: intervalo mínimo entre envios, "digitando…" no acuse e registro do id antes de enviar', async () => {
  let clock = 1_000_000;
  const waits: number[] = [];
  const calls: string[] = [];
  const marked: string[] = [];
  const sock: SockLike = {
    user: { id: '5551@s.whatsapp.net' },
    async sendPresenceUpdate(type) {
      calls.push(`presence:${type}`);
    },
    async sendMessage(jid, content, opts) {
      // o id já estava registrado quando o envio começou
      assert.ok(marked.includes(opts!.messageId!));
      calls.push(`send:${jid}:${content.text}`);
    },
  };
  const sender = createSender({
    getSock: () => sock,
    generateId: () => `ID${marked.length + 1}`,
    onSending: (id) => void marked.push(id),
    minIntervalMs: 1500,
    typingMs: 400,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });

  const a = sender.send({ instanceId: 'i1', jid: 'a@g.us', text: 'um', typing: true });
  const b = sender.send({ instanceId: 'i1', jid: 'b@g.us', text: 'dois' });
  assert.deepEqual([await a, await b], ['ID1', 'ID2']);
  assert.deepEqual(calls, ['presence:composing', 'send:a@g.us:um', 'presence:paused', 'send:b@g.us:dois']);
  // 400 ms de "digitando…" e depois espera para completar 1500 ms entre os dois envios
  assert.deepEqual(waits, [400, 1500]);
});

test('sender: falha de envio vai para quem pediu e não trava a fila; sem conexão avisa', async () => {
  let fail = true;
  const sock: SockLike = {
    user: { id: '5551@s.whatsapp.net' },
    async sendMessage() {
      if (fail) throw new Error('boom');
    },
  };
  let connected = true;
  const sender = createSender({
    getSock: () => (connected ? sock : undefined),
    generateId: () => 'ID',
    onSending: () => undefined,
    minIntervalMs: 0,
    sleep: async () => undefined,
  });
  await assert.rejects(sender.send({ instanceId: 'i1', jid: 'a@g.us', text: 'x' }), /boom/);
  fail = false;
  assert.equal(await sender.send({ instanceId: 'i1', jid: 'a@g.us', text: 'y' }), 'ID'); // a fila continuou
  connected = false;
  await assert.rejects(sender.send({ instanceId: 'i1', jid: 'a@g.us', text: 'z' }), /não está conectado/);
});

test('sender: mensagem com menções leva as menções no envio', async () => {
  let content: { text: string; mentions?: string[] } | undefined;
  const sender = createSender({
    getSock: () => ({ user: { id: 'x' }, sendMessage: async (_j, c) => void (content = c) }),
    generateId: () => 'ID',
    onSending: () => undefined,
    minIntervalMs: 0,
    sleep: async () => undefined,
  });
  await sender.send({ instanceId: 'i1', jid: 'a@g.us', text: 'oi @5551', mentions: ['5551@s.whatsapp.net'] });
  assert.deepEqual(content, { text: 'oi @5551', mentions: ['5551@s.whatsapp.net'] });
});

// ------------------------------------------------------------------ textos

test('messagePreview e formatWait', () => {
  assert.equal(messagePreview('text', '  olá,   tudo\nbem?  '), 'olá, tudo bem?');
  assert.equal(messagePreview('image', null), '[imagem]');
  assert.equal(messagePreview('image', 'nota fiscal'), '[imagem] nota fiscal');
  assert.equal(messagePreview('audio', null), '[áudio]');
  assert.equal(messagePreview('text', 'x'.repeat(200)).length, 140);
  assert.equal(formatWait(14), '14 min');
  assert.equal(formatWait(65), '1h05');
  assert.equal(
    escalationText({ minutes: 20, group: 'G', client: null, preview: '', link: '', mentions: ['5551@s.whatsapp.net'] }),
    '⏰🚨 SEM RESPOSTA há 20 min\nGrupo: G\nCliente: cliente\n@5551',
  );
});

test('o registro de mensagens do bot esquece depois do prazo', () => {
  let now = 0;
  const bots = createBotRegistry(1000, () => now);
  bots.mark('A');
  assert.equal(bots.has('A'), true);
  now = 1500;
  assert.equal(bots.has('A'), false);
  assert.equal(bots.has(undefined), false);
});

// ------------------------------------------------------------------ cobranças em etapas (0158)

const GRUPO = ['5551900000001@s.whatsapp.net', '5551900000002@s.whatsapp.net'];
const SETOR = ['5551900000009@s.whatsapp.net'];
const step = (over: Partial<import('./types.js').EscalationStep> = {}): import('./types.js').EscalationStep => ({
  waitMin: null,
  mentionGroupResponsibles: false,
  mentionSectorResponsibles: false,
  mentionJids: [],
  ...over,
});

test('stepFor: a etapa da cobrança; passando da última, repete a última; sem etapas, null', () => {
  const a = step({ mentionGroupResponsibles: true });
  const b = step({ mentionSectorResponsibles: true });
  assert.equal(stepFor({ escalationSteps: [] }, 0), null);
  assert.equal(stepFor({ escalationSteps: [a, b] }, 0), a);
  assert.equal(stepFor({ escalationSteps: [a, b] }, 1), b);
  assert.equal(stepFor({ escalationSteps: [a, b] }, 5), b);
});

test('waitMinutesFor: tempo da etapa; sem ele, "cobrar depois de" (1ª) e "repetir a cada" (demais, mínimo 1)', () => {
  const rule = { escalateAfterMin: 15, repeatEveryMin: 30 };
  assert.equal(waitMinutesFor({ ...rule, escalationSteps: [] }, 0), 15);
  assert.equal(waitMinutesFor({ ...rule, escalationSteps: [] }, 1), 30);
  assert.equal(waitMinutesFor({ ...rule, escalationSteps: [step({ waitMin: 5 }), step({ waitMin: 10 })] }, 0), 5);
  assert.equal(waitMinutesFor({ ...rule, escalationSteps: [step({ waitMin: 5 }), step({ waitMin: 10 })] }, 1), 10);
  // além das etapas: repete no ritmo geral
  assert.equal(waitMinutesFor({ ...rule, escalationSteps: [step({ waitMin: 5 })] }, 2), 30);
  assert.equal(waitMinutesFor({ escalateAfterMin: 0, repeatEveryMin: 0, escalationSteps: [] }, 0), 0);
  assert.equal(waitMinutesFor({ escalateAfterMin: 0, repeatEveryMin: 0, escalationSteps: [] }, 1), 1);
});

test('1ª cobrança marca os responsáveis do grupo; a 2ª marca o responsável do setor', async () => {
  const t = setup({
    escalationSteps: [step({ mentionGroupResponsibles: true }), step({ mentionSectorResponsibles: true })],
  });
  t.setResponsibles({ group: GRUPO, sector: SETOR });
  await t.automation.handleMessage(t.client());
  const cobrancas = () => t.sent.filter((s) => s.text.startsWith('⏰🚨'));

  t.advance(min(16)); // 1ª (cobrar depois de 15)
  await t.automation.checkEscalations();
  assert.deepEqual(cobrancas()[0].mentions, GRUPO);
  assert.ok(cobrancas()[0].text.includes('@5551900000001') && !cobrancas()[0].text.includes('@5551900000009'));

  t.advance(min(30)); // 2ª (repetir a cada 30)
  await t.automation.checkEscalations();
  assert.deepEqual(cobrancas()[1].mentions, SETOR);
  assert.ok(cobrancas()[1].text.includes('@5551900000009') && !cobrancas()[1].text.includes('@5551900000001'));

  t.advance(min(30)); // 3ª: passou da última etapa, repete a última (setor)
  await t.automation.checkEscalations();
  assert.deepEqual(cobrancas()[2].mentions, SETOR);
  assert.equal(t.pendings[0].escalationCount, 3);
});

test('etapa junta responsáveis do grupo, do setor e pessoas escolhidas, sem repetir ninguém', async () => {
  const fixo = '5551977770000@s.whatsapp.net';
  const t = setup({
    escalationSteps: [step({ mentionGroupResponsibles: true, mentionSectorResponsibles: true, mentionJids: [fixo, GRUPO[0]] })],
  });
  t.setResponsibles({ group: GRUPO, sector: [GRUPO[1], ...SETOR] });
  await t.automation.handleMessage(t.client());
  t.advance(min(16));
  await t.automation.checkEscalations();
  const cobranca = t.sent.find((s) => s.text.startsWith('⏰🚨'))!;
  assert.deepEqual(new Set(cobranca.mentions), new Set([fixo, ...GRUPO, ...SETOR]));
  assert.equal(cobranca.mentions!.length, 4);
  assert.ok(t.logs.at(-1)!.detail!.includes('marcou 4 pessoa(s)'));
});

test('cada etapa pode ter o seu tempo: 5 min para a 1ª e 10 min depois para a 2ª', async () => {
  const t = setup({ escalationSteps: [step({ waitMin: 5, mentionGroupResponsibles: true }), step({ waitMin: 10, mentionSectorResponsibles: true })] });
  t.setResponsibles({ group: GRUPO, sector: SETOR });
  await t.automation.handleMessage(t.client());
  const cobrancas = () => t.sent.filter((s) => s.text.startsWith('⏰🚨')).length;
  t.advance(min(4));
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 0);
  t.advance(min(1)); // 5 min
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 1);
  t.advance(min(9)); // 9 min desde a 1ª
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 1);
  t.advance(min(1)); // 10 min desde a 1ª
  await t.automation.checkEscalations();
  assert.equal(cobrancas(), 2);
});

test('falha ao buscar os responsáveis não impede a cobrança: sai com as pessoas escolhidas', async () => {
  const fixo = '5551977770000@s.whatsapp.net';
  const t = setup({ escalationSteps: [step({ mentionGroupResponsibles: true, mentionJids: [fixo] })] });
  t.failResponsiblesLookup(true);
  await t.automation.handleMessage(t.client());
  t.advance(min(16));
  assert.equal(await t.automation.checkEscalations(), 1);
  assert.deepEqual(t.sent.find((s) => s.text.startsWith('⏰🚨'))!.mentions, [fixo]);
  assert.ok(t.logsOut.some((l) => l.level === 'warn' && /responsáveis/.test(l.msg ?? '')));
});

test('grupo sem responsável cadastrado: cobrança sai mesmo assim, sem marcar ninguém', async () => {
  const t = setup({ escalationSteps: [step({ mentionGroupResponsibles: true, mentionSectorResponsibles: true })] });
  t.setResponsibles({ group: [], sector: [] });
  await t.automation.handleMessage(t.client());
  t.advance(min(16));
  assert.equal(await t.automation.checkEscalations(), 1);
  assert.deepEqual(t.sent.find((s) => s.text.startsWith('⏰🚨'))!.mentions, []);
});

test('sem etapas, tudo continua como antes: todas as cobranças marcam mentionJids da regra', async () => {
  const t = setup(); // escalationSteps: []
  t.setResponsibles({ group: GRUPO, sector: SETOR }); // não são usados
  await t.automation.handleMessage(t.client());
  t.advance(min(16));
  await t.automation.checkEscalations();
  t.advance(min(30));
  await t.automation.checkEscalations();
  const cobrancas = t.sent.filter((s) => s.text.startsWith('⏰🚨'));
  assert.equal(cobrancas.length, 2);
  for (const c of cobrancas) assert.deepEqual(c.mentions, baseRule.mentionJids);
  assert.ok(!t.logs.at(-1)!.detail!.includes('marcou'));
});

// ------------------------------------------------------------------ espera antes do acuse (0159)

test('espera 0: acuse na hora e depois o aviso, como sempre', async () => {
  const t = setup();
  await t.automation.handleMessage(t.client());
  assert.equal(t.scheduled.length, 0);
  assert.equal(t.sent[0].text, 'ACK DENTRO');
  assert.equal(t.sent[1].jid, 'interno@g.us');
});

test('espera de 20 s: o aviso e o alerta saem na hora e o acuse só depois da espera', async () => {
  const t = setup({ ackDelaySec: 20 });
  await t.automation.handleMessage(t.client());
  // na hora: aviso no grupo interno e alerta em tela, sem acuse
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].jid, 'interno@g.us');
  assert.equal(t.alerts.length, 1);
  assert.equal(t.scheduled.length, 1);
  assert.equal(t.scheduled[0].ms, 20_000);
  t.advance(20_000);
  await t.runScheduled();
  assert.equal(t.sent.length, 2);
  assert.equal(t.sent[1].jid, 'cliente@g.us');
  assert.equal(t.sent[1].text, 'ACK DENTRO');
  assert.equal(t.logs.filter((l) => l.action === 'ACK').length, 1);
});

test('se a equipe responder durante a espera, o acuse não é enviado', async () => {
  const t = setup({ ackDelaySec: 30 });
  await t.automation.handleMessage(t.client());
  t.advance(10_000);
  await t.automation.handleMessage(t.team()); // equipe respondeu: encerra a demanda
  t.advance(20_000);
  await t.runScheduled();
  assert.ok(!t.sent.some((s) => s.jid === 'cliente@g.us'), 'nenhum acuse no grupo do cliente');
  assert.equal(t.logs.filter((l) => l.action === 'ACK').length, 0);
});

test('automação desligada durante a espera: o acuse não é enviado', async () => {
  const t = setup({ ackDelaySec: 15 });
  await t.automation.handleMessage(t.client());
  t.setEnabled(false);
  t.advance(15_000);
  await t.runScheduled();
  assert.ok(!t.sent.some((s) => s.jid === 'cliente@g.us'));
});

test('o acuse com espera segue o texto fora do horário e respeita o intervalo entre acuses', async () => {
  const t = setup({ ackDelaySec: 10 }, NIGHT);
  await t.automation.handleMessage(t.client());
  t.advance(10_000);
  await t.runScheduled();
  assert.equal(t.sent.find((s) => s.jid === 'cliente@g.us')!.text, 'ACK FORA');
});
