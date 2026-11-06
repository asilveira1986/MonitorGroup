import { generateMessageIDV2 } from 'baileys';
import { createBotRegistry } from '../automation/service.js';
import { createSender } from '../automation/sender.js';
import type { SockLike } from '../automation/types.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { serializePollMessage } from './poll.js';
import { createClosing, type ClosingService } from './service.js';
import { createSupabaseClosingStore } from './store.js';
import type { ClosingSender } from './types.js';

type PollSock = SockLike & {
  sendMessage(jid: string, content: unknown, opts?: { messageId?: string }): Promise<unknown>;
};

/** Monta a pesquisa de encerramento (0149) sobre as conexões do worker e o Supabase. */
export function createWorkerClosing(connections: { getSock(instanceId: string): SockLike | undefined }): ClosingService {
  const bots = createBotRegistry();
  const text = createSender({
    getSock: (instanceId) => connections.getSock(instanceId),
    generateId: (sock) => generateMessageIDV2(sock.user?.id),
    onSending: (id) => bots.mark(id),
    minIntervalMs: env.sendMinIntervalMs,
  });
  const sender: ClosingSender = {
    sendText: (req) => text.send({ ...req, typing: false }),
    async sendPoll(req) {
      const sock = connections.getSock(req.instanceId) as PollSock | undefined;
      if (!sock || !sock.user) throw new Error('WhatsApp da instância não está conectado.');
      const id = generateMessageIDV2(sock.user.id);
      bots.mark(id);
      const sent = (await sock.sendMessage(
        req.jid,
        { poll: { name: req.question, values: req.options, selectableCount: 1 } },
        { messageId: id },
      )) as { message?: unknown } | undefined;
      if (!sent?.message) throw new Error('A enquete foi enviada sem retorno da mensagem.');
      return { id, message: serializePollMessage(sent.message) };
    },
  };
  return createClosing({
    store: createSupabaseClosingStore(),
    sender,
    logger,
    panelUrl: env.panelUrl,
    isBot: (id) => bots.has(id),
  });
}
