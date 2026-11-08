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

export type CampaignMedia = {
  path: string;
  type: 'image' | 'video' | 'document' | 'audio';
  mime: string;
  name: string | null;
};

/** Só enviar em certos dias e horas (no fuso da empresa). */
export type SendWindow = { days: number[]; start: string; end: string };

export type Campaign = {
  id: string;
  companyId: string;
  name: string;
  target: 'groups' | 'people';
  /** texto principal (legenda quando há arquivo; pode ser vazio com arquivo) */
  message: string;
  /** textos alternativos: cada destinatário recebe um deles (ou o principal) */
  variants: string[];
  media: CampaignMedia | null;
  window: SendWindow | null;
  /** rodapé "responda SAIR" nas mensagens a pessoas */
  optoutFooter: boolean;
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
  /** a pessoa pediu para não receber? (conferido de novo antes de cada envio) */
  isOptedOut(companyId: string, phone: string): Promise<boolean>;
  /** não enviou de propósito (opt-out): conta como "não enviado", não como falha */
  markSkipped(recipientId: string, reason: string): Promise<void>;
  /** arquivo do disparo guardado no Storage */
  loadMedia(path: string): Promise<Buffer>;
  /** enviadas por este número desde o instante informado */
  countSent(instanceId: string, since: Date): Promise<number>;
  /** pendentes + em envio */
  openCount(campaignId: string): Promise<number>;
  finish(campaignId: string): Promise<void>;
  /** pausa automática (falhas seguidas): o administrador retoma no painel */
  pause(campaignId: string): Promise<void>;
  /** cria o envio de cada disparo recorrente que chegou na hora; devolve quantos criou */
  spawnDue(): Promise<number>;
  /** cria o envio dos gatilhos (etiqueta aplicada, aniversário) para quem entrou na regra; devolve quantos criou */
  runTriggers(): Promise<number>;
  /** recibo do WhatsApp de uma mensagem enviada (3 entregue, 4 lida) */
  track(waMessageId: string, status: number): Promise<void>;
  /** destinatários que ficaram "enviando" por uma queda do worker: não reenviar (evita duplicar) */
  failStuck(): Promise<number>;
};

export type BroadcastSock = {
  user?: { id?: string } | null;
  sendMessage(jid: string, content: Record<string, unknown>, opts?: { messageId?: string }): Promise<unknown>;
  sendPresenceUpdate?(type: 'composing' | 'paused', jid: string): Promise<unknown>;
  onWhatsApp?(...phoneNumber: string[]): Promise<{ jid: string; exists: boolean }[] | undefined>;
};
