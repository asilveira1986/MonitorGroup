import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { createClosing, matchOption, normalizeAnswer, type ClosingMessage } from './service.js';
import { selectedIndex } from './poll.js';
import type { ClosingAlert, ClosingFlow, ClosingOption, ClosingSender, ClosingStore, NewSurvey, Survey } from './types.js';

const OPTIONS: ClosingOption[] = [
  { label: 'Sim, resolvido', reply: 'Que bom! Ficamos à disposição.', reopen: false, notify: false },
  { label: 'Não, preciso de ajuda', reply: 'Vamos retomar seu atendimento.', reopen: true, notify: true },
];

const FLOW: ClosingFlow = {
  id: 'f1', companyId: 'c1', enabled: true, name: 'Pesquisa', question: 'Seu atendimento foi resolvido?', options: OPTIONS,
  groupIds: ['g1'], delayMin: 5, expireHours: 24, notifyGroupJid: 'interno@g.us', notifyGroupName: 'Trabalhista', mentionJids: ['5511@s.whatsapp.net'],
};

function memory(flow: ClosingFlow | null = FLOW) {
  const surveys: (Survey & { answer?: string; pollMessage?: string })[] = [];
  const alerts: ClosingAlert[] = [];
  const reopened: string[] = [];
  const store: ClosingStore = {
    getFlowForGroup: async (g) => (flow && flow.enabled && flow.groupIds.includes(g) ? flow : null),
    getFlow: async () => flow,
    createSurvey: async (s: NewSurvey) => {
      if (surveys.some((x) => x.groupId === s.groupId && (x.status === 'scheduled' || x.status === 'sent'))) return null;
      const v = { id: `s${surveys.length + 1}`, ...s, groupName: 'Cliente X', status: 'scheduled' as const, expiresAt: null, pollWaId: null };
      surveys.push(v);
      return v;
    },
    cancelScheduled: async (g) => {
      const l = surveys.filter((s) => s.groupId === g && s.status === 'scheduled');
      l.forEach((s) => (s.status = 'cancelled'));
      return l.length;
    },
    getSentSurvey: async (g) => surveys.find((s) => s.groupId === g && s.status === 'sent') ?? null,
    findSentByPoll: async (p) => surveys.find((s) => s.pollWaId === p && s.status === 'sent') ?? null,
    listDue: async (now) => surveys.filter((s) => s.status === 'scheduled' && s.sendAt <= now),
    listExpired: async (now) => surveys.filter((s) => s.status === 'sent' && s.expiresAt && s.expiresAt <= now),
    markSent: async (id, i) => {
      const s = surveys.find((x) => x.id === id)!;
      Object.assign(s, { status: 'sent', pollWaId: i.pollWaId, pollMessage: i.pollMessage, expiresAt: i.expiresAt });
    },
    markExpired: async (id) => void (surveys.find((x) => x.id === id)!.status = 'expired'),
    markFailed: async (id) => void (surveys.find((x) => x.id === id)!.status = 'cancelled'),
    markAnswered: async (id, a) => {
      const s = surveys.find((x) => x.id === id)!;
      if (s.status !== 'sent') return false;
      Object.assign(s, { status: 'answered', answer: a.label });
      return true;
    },
    createAlert: async (a) => void alerts.push(a),
    reopenGroup: async (g) => void reopened.push(g),
  };
  return { store, surveys, alerts, reopened };
}

function setup(flow: ClosingFlow | null = FLOW) {
  const mem = memory(flow);
  let t = new Date('2026-05-04T14:00:00Z');
  const texts: { jid: string; text: string; mentions?: string[] }[] = [];
  const polls: { jid: string; question: string; options: string[] }[] = [];
  let failPoll = false;
  const sender: ClosingSender = {
    sendText: async (r) => (texts.push(r), 'id-text'),
    sendPoll: async (r) => {
      if (failPoll) throw new Error('offline');
      polls.push(r);
      return { id: `poll-${polls.length}`, message: '{}' };
    },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const svc = createClosing({ store: mem.store, sender, logger, now: () => t, panelUrl: 'https://painel.test' });
  const msg = (over: Partial<ClosingMessage> = {}): ClosingMessage => ({
    companyId: 'c1', instanceId: 'i1', group: { id: 'g1', jid: 'g1@g.us', name: 'Cliente X' }, fromTeam: true, closes: true,
    senderName: 'Ana', text: 'encerrado', sentAt: t, isNotify: true, ...over,
  });
  return { svc, ...mem, texts, polls, msg, advance: (min: number) => (t = new Date(t.getTime() + min * 60_000)), failPoll: (v: boolean) => (failPoll = v) };
}

describe('texto da resposta', () => {
  it('normaliza e escolhe a opção', () => {
    assert.equal(normalizeAnswer('  Sim, Resolvido! '), 'sim resolvido');
    assert.equal(matchOption('1', OPTIONS), 0);
    assert.equal(matchOption('2', OPTIONS), 1);
    assert.equal(matchOption('3', OPTIONS), -1);
    assert.equal(matchOption('sim resolvido', OPTIONS), 0);
    assert.equal(matchOption('talvez', OPTIONS), -1);
  });
  it('acha o índice pelo hash do voto', () => {
    const names = ['A', 'B'];
    const hash = createHash('sha256').update(Buffer.from('B')).digest();
    assert.equal(selectedIndex(names, [hash]), 1);
    assert.equal(selectedIndex(names, []), null);
  });
});

describe('pesquisa de encerramento', () => {
  it('agenda após o fechamento e envia a enquete no horário', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    assert.equal(s.surveys.length, 1);
    await s.svc.tick();
    assert.equal(s.polls.length, 0); // ainda não passou o atraso
    s.advance(6);
    await s.svc.tick();
    assert.equal(s.polls.length, 1);
    assert.deepEqual(s.polls[0].options, ['Sim, resolvido', 'Não, preciso de ajuda']);
    assert.equal(s.surveys[0].status, 'sent');
  });

  it('não agenda sem regra, desligada ou para mensagem comum da equipe', async () => {
    const none = setup(null);
    await none.svc.handleMessage(none.msg());
    assert.equal(none.surveys.length, 0);
    const s = setup();
    await s.svc.handleMessage(s.msg({ closes: false }));
    await s.svc.handleMessage(s.msg({ isNotify: false }));
    assert.equal(s.surveys.length, 0);
  });

  it('não duplica a pergunta em andamento', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    await s.svc.handleMessage(s.msg());
    assert.equal(s.surveys.length, 1);
  });

  it('cancela a pergunta se o cliente escrever antes do envio', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    await s.svc.handleMessage(s.msg({ fromTeam: false, closes: false, text: 'ainda tenho uma dúvida' }));
    s.advance(10);
    await s.svc.tick();
    assert.equal(s.polls.length, 0);
    assert.equal(s.surveys[0].status, 'cancelled');
  });

  it('voto "não": responde, reabre, cria alerta e avisa o grupo interno com menção', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.advance(6);
    await s.svc.tick();
    await s.svc.handleVote({ pollWaId: 'poll-1', optionIndex: 1, voterName: 'Cliente' });
    assert.equal(s.surveys[0].status, 'answered');
    assert.equal(s.texts[0].jid, 'g1@g.us');
    assert.match(s.texts[0].text, /retomar/);
    assert.deepEqual(s.reopened, ['g1']);
    assert.equal(s.alerts.length, 1);
    const notice = s.texts[1];
    assert.equal(notice.jid, 'interno@g.us');
    assert.match(notice.text, /Não, preciso de ajuda/);
    assert.deepEqual(notice.mentions, ['5511@s.whatsapp.net']);
  });

  it('voto "sim": só agradece, sem reabrir nem avisar', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.advance(6);
    await s.svc.tick();
    await s.svc.handleVote({ pollWaId: 'poll-1', optionIndex: 0, voterName: null });
    assert.equal(s.texts.length, 1);
    assert.equal(s.reopened.length, 0);
    assert.equal(s.alerts.length, 0);
  });

  it('uma segunda resposta é ignorada', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.advance(6);
    await s.svc.tick();
    await s.svc.handleVote({ pollWaId: 'poll-1', optionIndex: 0, voterName: null });
    await s.svc.handleVote({ pollWaId: 'poll-1', optionIndex: 1, voterName: null });
    assert.equal(s.reopened.length, 0);
    assert.equal(s.texts.length, 1);
  });

  it('resposta digitada ("2") vale como voto', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.advance(6);
    await s.svc.tick();
    await s.svc.handleMessage(s.msg({ fromTeam: false, closes: false, text: '2', senderName: 'Cliente' }));
    assert.equal(s.surveys[0].status, 'answered');
    assert.deepEqual(s.reopened, ['g1']);
  });

  it('expira sem resposta', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.advance(6);
    await s.svc.tick();
    s.advance(25 * 60);
    await s.svc.tick();
    assert.equal(s.surveys[0].status, 'expired');
  });

  it('falha de envio: tenta de novo e desiste depois de 10 minutos', async () => {
    const s = setup();
    await s.svc.handleMessage(s.msg());
    s.failPoll(true);
    s.advance(6);
    await s.svc.tick();
    assert.equal(s.surveys[0].status, 'scheduled');
    s.advance(10);
    await s.svc.tick();
    assert.equal(s.surveys[0].status, 'cancelled');
  });
});
