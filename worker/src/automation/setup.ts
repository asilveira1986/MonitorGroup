import { generateMessageIDV2 } from 'baileys';
import { getSettings } from '../cache.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { createAutomation, createBotRegistry, type AutomationService } from './service.js';
import { createSender } from './sender.js';
import { createSupabaseStore } from './store.js';
import type { SockLike } from './types.js';

/** Monta a automação de atendimento (0144) sobre as conexões do worker e o Supabase. */
export function createWorkerAutomation(connections: { getSock(instanceId: string): SockLike | undefined }): AutomationService {
  const bots = createBotRegistry();
  const sender = createSender({
    getSock: (instanceId) => connections.getSock(instanceId),
    generateId: (sock) => generateMessageIDV2(sock.user?.id),
    onSending: (id) => bots.mark(id),
    minIntervalMs: env.sendMinIntervalMs,
  });
  return createAutomation({
    store: createSupabaseStore(),
    sender,
    bots,
    logger,
    panelUrl: env.panelUrl,
    getTimezone: async (companyId) => {
      try {
        return (await getSettings(companyId)).timezone || env.tzAtendimento;
      } catch {
        return env.tzAtendimento;
      }
    },
  });
}
