import { generateMessageIDV2 } from 'baileys';
import { createBotRegistry } from '../automation/service.js';
import { db } from '../db.js';
import { logger } from '../logger.js';
import { privateEnabled } from '../private.js';
import { createBroadcast, type BroadcastService } from './runner.js';
import { createSupabaseBroadcastStore } from './store.js';
import type { BroadcastSock } from './types.js';

export type WorkerBroadcast = BroadcastService & { isBotMessage(id: string | null | undefined): boolean };

/** Monta os disparos em massa (0150) sobre as conexões do worker e o Supabase. */
export function createWorkerBroadcast(connections: { getSock(instanceId: string): unknown }): WorkerBroadcast {
  const bots = createBotRegistry();
  const service = createBroadcast({
    store: createSupabaseBroadcastStore(),
    getSock: (instanceId) => connections.getSock(instanceId) as BroadcastSock | undefined,
    generateId: (sock) => generateMessageIDV2(sock.user?.id),
    onSending: (id) => bots.mark(id),
    // a mensagem enviada a uma pessoa entra na conversa privada (quando o módulo está ligado na empresa)
    afterPersonSent: async ({ instanceId, companyId, jid, phone, waId, text, campaign }) => {
      if (!(await privateEnabled(companyId))) return;
      await db.rpc('ingest_private_message', {
        p_instance_id: instanceId,
        p_jid: jid,
        p_phone: phone,
        p_name: null,
        p_wa_message_id: waId,
        p_from_me: true,
        p_sender_name: `Disparo: ${campaign}`.slice(0, 80),
        p_message_type: 'text',
        p_body: text,
        p_sent_at: new Date().toISOString(),
        p_count_unread: false,
      });
    },
    logger,
  });
  return { ...service, isBotMessage: (id) => bots.has(id) };
}
