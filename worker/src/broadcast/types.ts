/** Disparos em massa (0150): tipos compartilhados entre o serviço, o banco e o envio. */

export type BroadcastSettings = {
  /** intervalo aleatório entre duas mensagens do mesmo número, em segundos */
  minDelayS: number;
  maxDelayS: number;
  /** pausa longa a cada lote */
  batchSize: number;
  batchPauseMin: number;
  /** máximo de mensagens por número em 24 horas */
  dailyLimit: number;
};

export type Campaign = {
  id: string;
  companyId: string;
  name: string;
  target: 'groups' | 'people';
  message: string;
};

export type Recipient = {
  id: string;
  campaignId: string;
  kind: 'group' | 'person';
  name: string | null;
  phone: string | null;
  jid: string | null;
  instanceId: string | null;
};

export type BroadcastStore = {
  /** campanhas agendadas que já chegaram na hora passam a "em envio" */
  startDue(now: Date): Promise<void>;
  listRunning(): Promise<Campaign[]>;
  getSettings(companyId: string): Promise<BroadcastSettings>;
  /** próximos destinatários pendentes (em ordem) */
  listPending(campaignId: string, limit: number): Promise<Recipient[]>;
  /** reserva o destinatário; false se outro processo já pegou */
  claim(recipientId: string): Promise<boolean>;
  markSent(recipientId: string, waMessageId: string, sentAt: Date): Promise<void>;
  markFailed(recipientId: string, error: string): Promise<void>;
  /** enviadas por este número desde o instante informado */
  countSent(instanceId: string, since: Date): Promise<number>;
  /** pendentes + em envio */
  openCount(campaignId: string): Promise<number>;
  finish(campaignId: string): Promise<void>;
  /** pausa automática (falhas seguidas): o administrador retoma no painel */
  pause(campaignId: string): Promise<void>;
  /** destinatários que ficaram "enviando" por uma queda do worker: não reenviar (evita duplicar) */
  failStuck(): Promise<number>;
};

export type BroadcastSock = {
  user?: { id?: string } | null;
  sendMessage(jid: string, content: { text: string }, opts?: { messageId?: string }): Promise<unknown>;
  sendPresenceUpdate?(type: 'composing' | 'paused', jid: string): Promise<unknown>;
  onWhatsApp?(...phoneNumber: string[]): Promise<{ jid: string; exists: boolean }[] | undefined>;
};
