import type { ClosingFlow, ClosingOption, ClosingSender, ClosingStore, Survey } from './types.js';

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

export type ClosingMessage = {
  companyId: string;
  instanceId: string;
  group: { id: string; jid: string; name: string };
  fromTeam: boolean;
  /** a equipe encerrou o atendimento (mensagem de fechamento) */
  closes: boolean;
  senderName: string | null;
  senderJid?: string | null;
  text: string;
  sentAt: Date;
  /** só mensagens novas (notify) disparam; histórico e sincronizações não */
  isNotify: boolean;
};

export type ClosingDeps = {
  store: ClosingStore;
  sender: ClosingSender;
  logger: Log;
  now?: () => Date;
  tickMs?: number;
  /** ids das mensagens enviadas pelo próprio fluxo (para não contarem como resposta da equipe) */
  isBot?: (id: string | null | undefined) => boolean;
};

const MIN = 60_000;

/** Texto sem acento/caixa/pontuação, para comparar a resposta digitada com as opções. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Qual opção o texto digitado escolhe: "1", "2"... ou o texto da opção. -1 se nenhuma. */
export function matchOption(text: string, options: ClosingOption[]): number {
  const t = normalizeAnswer(text);
  if (!t) return -1;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= options.length ? n - 1 : -1;
  }
  return options.findIndex((o) => normalizeAnswer(o.label) === t);
}

export function answerNotice(opts: { group: string; client: string | null; answer: string; reopen: boolean; link: string }): string {
  const who = opts.client ? `${opts.client} respondeu` : 'O cliente respondeu';
  return [
    `📋 *Pesquisa de encerramento* — ${opts.group}`,
    `${who}: *${opts.answer}*`,
    ...(opts.reopen ? ['🔁 O atendimento foi reaberto.'] : []),
    ...(opts.link ? [`Abrir no painel: ${opts.link}`] : []),
  ].join('\n');
}

export function createClosing(deps: ClosingDeps & { panelUrl?: string }) {
  const { store, sender, logger } = deps;
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  /** A equipe encerrou: agenda a pergunta. A de outro cliente em andamento não é duplicada. */
  async function scheduleFor(m: ClosingMessage): Promise<Survey | null> {
    const flow = await store.getFlowForGroup(m.group.id);
    if (!flow || !flow.enabled || flow.options.length < 2) return null;
    return store.createSurvey({
      companyId: m.companyId,
      flowId: flow.id,
      groupId: m.group.id,
      instanceId: m.instanceId,
      groupJid: m.group.jid,
      sendAt: new Date(m.sentAt.getTime() + flow.delayMin * MIN),
      question: flow.question,
      options: flow.options,
    });
  }

  /** Uma mensagem de grupo já gravada. */
  async function handleMessage(m: ClosingMessage): Promise<void> {
    if (!m.isNotify) return;
    if (m.fromTeam) {
      if (m.closes) {
        const s = await scheduleFor(m);
        if (s) logger.info({ group: m.group.name, at: s.sendAt }, 'pesquisa de encerramento agendada');
      }
      return;
    }
    // o cliente voltou a escrever: a conversa não terminou
    const cancelled = await store.cancelScheduled(m.group.id);
    if (cancelled) logger.info({ group: m.group.name }, 'pesquisa de encerramento cancelada: o cliente escreveu');
    // resposta digitada ("1", "2" ou o texto da opção) à pergunta já enviada
    const open = await store.getSentSurvey(m.group.id);
    if (open) {
      const index = matchOption(m.text, open.options);
      if (index >= 0) await answer(open, index, m.senderName);
    }
  }

  /** Voto na enquete (já decifrado): índice da opção escolhida. */
  async function handleVote(v: { pollWaId: string; optionIndex: number; voterName: string | null }): Promise<void> {
    const survey = await store.findSentByPoll(v.pollWaId);
    if (!survey) return;
    await answer(survey, v.optionIndex, v.voterName);
  }

  async function answer(survey: Survey, index: number, by: string | null): Promise<void> {
    const option = survey.options[index];
    if (!option) return;
    const first = await store.markAnswered(survey.id, { label: option.label, index, by, at: now() });
    if (!first) return; // outro voto/resposta chegou antes
    logger.info({ group: survey.groupName, answer: option.label }, 'resposta da pesquisa de encerramento');
    const flow = survey.flowId ? await store.getFlow(survey.flowId) : null;
    const instanceId = survey.instanceId;
    if (!instanceId) return;

    if (option.reply.trim()) {
      await sender
        .sendText({ instanceId, jid: survey.groupJid, text: option.reply.trim() })
        .catch((err) => logger.warn({ err }, 'falha ao responder a pesquisa de encerramento'));
    }
    if (option.reopen) {
      await store.reopenGroup(survey.groupId, now());
      await store.createAlert({
        companyId: survey.companyId,
        groupId: survey.groupId,
        instanceId,
        severity: 'warning',
        title: 'Cliente pediu para reabrir o atendimento',
        description: `${by ? `${by} respondeu` : 'Resposta'} "${option.label}" à pesquisa de encerramento.`,
      });
    }
    if ((option.notify || option.reopen) && flow?.notifyGroupJid) {
      await notifyInternal(flow, survey, option, by, instanceId);
    }
  }

  async function notifyInternal(flow: ClosingFlow, survey: Survey, option: ClosingOption, by: string | null, instanceId: string) {
    const link = deps.panelUrl ? `${deps.panelUrl.replace(/\/$/, '')}/groups/${survey.groupId}` : '';
    const text = answerNotice({ group: survey.groupName, client: by, answer: option.label, reopen: option.reopen, link });
    await sender
      .sendText({ instanceId, jid: flow.notifyGroupJid!, text, mentions: flow.mentionJids })
      .catch((err) => logger.warn({ err }, 'falha ao avisar o grupo interno da resposta'));
  }

  /** Envia as perguntas vencidas e encerra as sem resposta. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      for (const s of await store.listDue(t)) {
        if (!s.instanceId) {
          await store.markFailed(s.id);
          continue;
        }
        try {
          const flow = s.flowId ? await store.getFlow(s.flowId) : null;
          const expireHours = flow?.expireHours ?? 24;
          const poll = await sender.sendPoll({ instanceId: s.instanceId, jid: s.groupJid, question: s.question, options: s.options.map((o) => o.label) });
          await store.markSent(s.id, { pollWaId: poll.id, pollMessage: poll.message, sentAt: t, expiresAt: new Date(t.getTime() + expireHours * 60 * MIN) });
          logger.info({ group: s.groupName }, 'pesquisa de encerramento enviada');
        } catch (err) {
          logger.warn({ err, group: s.groupName }, 'falha ao enviar a pesquisa de encerramento');
          // sem conexão agora: tenta de novo no próximo ciclo, até 10 min depois do horário
          if (t.getTime() - s.sendAt.getTime() > 10 * MIN) await store.markFailed(s.id);
        }
      }
      for (const s of await store.listExpired(t)) {
        await store.markExpired(s.id);
        logger.info({ group: s.groupName }, 'pesquisa de encerramento sem resposta');
      }
    } catch (err) {
      logger.error({ err }, 'falha no verificador da pesquisa de encerramento');
    } finally {
      ticking = false;
    }
  }

  return {
    handleMessage,
    handleVote,
    tick,
    isBotMessage: (id: string | null | undefined) => Boolean(deps.isBot?.(id)),
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.tickMs ?? 30_000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type ClosingService = ReturnType<typeof createClosing>;
