import type { SockLike } from './types.js';

export type SendRequest = {
  instanceId: string;
  jid: string;
  text: string;
  mentions?: string[];
  /** mensagem a citar (a do cliente, no acuse) */
  quoted?: unknown;
  /** mostra "digitando…" antes de enviar (acuse) */
  typing?: boolean;
};

export type Sender = { send(req: SendRequest): Promise<string> };

/**
 * Fila de envio da automação: uma mensagem de cada vez, com intervalo mínimo entre elas e "digitando…"
 * no acuse, para parecer uso normal e reduzir o risco de bloqueio do número. Uma falha de envio chega a
 * quem pediu, mas nunca trava a fila.
 */
export function createSender(opts: {
  getSock: (instanceId: string) => SockLike | undefined;
  /** gera o id da mensagem; é registrado antes do envio para a mensagem do bot não contar como resposta */
  generateId: (sock: SockLike) => string;
  onSending: (id: string) => void;
  minIntervalMs?: number;
  typingMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Sender {
  const minInterval = opts.minIntervalMs ?? 1500;
  const typingMs = opts.typingMs ?? 900;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let queue: Promise<unknown> = Promise.resolve();
  let lastSentAt = 0;

  const run = async (req: SendRequest): Promise<string> => {
    const sock = opts.getSock(req.instanceId);
    if (!sock || !sock.user) throw new Error('WhatsApp da instância não está conectado.');
    const wait = lastSentAt + minInterval - now();
    if (wait > 0) await sleep(wait);
    if (req.typing && sock.sendPresenceUpdate) {
      await sock.sendPresenceUpdate('composing', req.jid).catch(() => undefined);
      await sleep(typingMs);
    }
    const id = opts.generateId(sock);
    opts.onSending(id);
    try {
      await sock.sendMessage(
        req.jid,
        { text: req.text, ...(req.mentions?.length ? { mentions: req.mentions } : {}) },
        { messageId: id, quoted: req.quoted },
      );
      return id;
    } finally {
      lastSentAt = now();
      if (req.typing && sock.sendPresenceUpdate) await sock.sendPresenceUpdate('paused', req.jid).catch(() => undefined);
    }
  };

  return {
    send(req) {
      const job = queue.then(() => run(req));
      // a fila segue mesmo que este envio falhe
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
