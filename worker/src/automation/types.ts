/** Automação de atendimento (0144): tipos compartilhados entre o serviço, o envio e o banco. */

export type AutomationRule = {
  groupId: string;
  companyId: string;
  enabled: boolean;
  ackEnabled: boolean;
  ackMessage: string;
  ackOffHours: string;
  ackCooldownMin: number;
  lastAckAt: Date | null;
  /** grupo interno que recebe o aviso e a cobrança (por exemplo, o Trabalhista) */
  notifyGroupJid: string;
  notifyGroupName: string;
  escalateAfterMin: number;
  repeatEveryMin: number;
  maxEscalations: number;
  escalateOffHours: boolean;
  /** quem é marcado na cobrança (jids do WhatsApp) */
  mentionJids: string[];
  /** 0 = domingo ... 6 = sábado */
  businessDays: number[];
  businessStart: string;
  businessEnd: string;
};

export type PendingReply = {
  id: string;
  companyId: string;
  groupId: string;
  instanceId: string | null;
  groupJid: string;
  groupName: string;
  /** id da mensagem do cliente no WhatsApp */
  firstMessageId: string;
  clientName: string | null;
  preview: string;
  messageCount: number;
  receivedAt: Date;
  escalationCount: number;
  lastEscalatedAt: Date | null;
  alertId: string | null;
};

export type NewPending = Omit<PendingReply, 'id' | 'escalationCount' | 'lastEscalatedAt' | 'alertId'>;

export type AlertInput = {
  companyId: string;
  groupId: string;
  instanceId: string | null;
  /** mensagem do cliente (uuid em messages), quando existe */
  messageId?: string | null;
  type: 'new_message' | 'no_reply';
  severity: 'warning' | 'critical';
  title: string;
  description: string;
};

export type LogAction = 'ACK' | 'ACK_OFFHOURS' | 'NOTIFY' | 'ESCALATE' | 'RESOLVED';

/** Demanda aberta com a regra e a situação do grupo, para o verificador de cobranças. */
export type OpenPending = {
  pending: PendingReply;
  rule: AutomationRule | null;
  /** o grupo ainda tem pendência no sistema (groups.pending_since)? Falso: alguém já respondeu por outro caminho */
  groupStillPending: boolean;
};

/** Acesso ao banco. Em produção é o Supabase (store.ts); nos testes, uma versão em memória. */
export interface AutomationStore {
  /** chave geral da empresa (app_settings.automation_enabled): desligada, a automação não age */
  isEnabled(companyId: string): Promise<boolean>;
  getRule(groupId: string): Promise<AutomationRule | null>;
  /** todos os grupos internos em uso (a automação nunca dispara por mensagens neles) */
  listNotifyJids(): Promise<string[]>;
  getOpenPending(groupId: string): Promise<PendingReply | null>;
  /** null: já existe uma demanda aberta neste grupo (duas mensagens chegando juntas) */
  createPending(p: NewPending): Promise<PendingReply | null>;
  bumpPending(id: string, preview: string, messageCount: number): Promise<void>;
  setPendingAlert(id: string, alertId: string): Promise<void>;
  markEscalated(id: string, count: number, at: Date): Promise<void>;
  resolvePending(id: string, by: string, responseSec: number, at: Date): Promise<void>;
  listOpenPending(): Promise<OpenPending[]>;
  createAlert(alert: AlertInput): Promise<string>;
  updateAlert(id: string, patch: { description: string }): Promise<void>;
  /** tira da tela os alertas da automação deste grupo (alert:resolved) */
  resolveAlerts(groupId: string, at: Date): Promise<void>;
  setLastAck(groupId: string, at: Date): Promise<void>;
  log(companyId: string, groupId: string, action: LogAction, detail: string | null): Promise<void>;
}

/** O que o envio precisa de uma conexão do WhatsApp. */
export type SockLike = {
  user?: { id?: string } | null;
  sendMessage(jid: string, content: { text: string; mentions?: string[] }, opts?: { messageId?: string; quoted?: unknown }): Promise<unknown>;
  sendPresenceUpdate?(type: 'composing' | 'paused', jid: string): Promise<unknown>;
};
