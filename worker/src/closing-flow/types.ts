/** Regra de mensagem de encerramento (0149): tipos compartilhados entre o serviço, o envio e o banco. */

export type ClosingOption = {
  label: string;
  /** texto enviado ao grupo do cliente quando esta opção é escolhida (vazio: não responde) */
  reply: string;
  /** reabre o atendimento: alerta em tela e o grupo volta a ficar pendente */
  reopen: boolean;
  /** avisa o grupo interno da escolha */
  notify: boolean;
};

export type ClosingFlow = {
  id: string;
  companyId: string;
  enabled: boolean;
  name: string;
  question: string;
  options: ClosingOption[];
  groupIds: string[];
  delayMin: number;
  expireHours: number;
  notifyGroupJid: string | null;
  notifyGroupName: string | null;
  mentionJids: string[];
};

export type SurveyStatus = 'scheduled' | 'sent' | 'answered' | 'expired' | 'cancelled';

export type Survey = {
  id: string;
  companyId: string;
  flowId: string | null;
  groupId: string;
  groupName: string;
  instanceId: string | null;
  groupJid: string;
  status: SurveyStatus;
  sendAt: Date;
  expiresAt: Date | null;
  pollWaId: string | null;
  question: string;
  options: ClosingOption[];
};

export type NewSurvey = {
  companyId: string;
  flowId: string;
  groupId: string;
  instanceId: string | null;
  groupJid: string;
  sendAt: Date;
  question: string;
  options: ClosingOption[];
};

export type ClosingAlert = {
  companyId: string;
  groupId: string;
  instanceId: string | null;
  severity: 'warning' | 'critical';
  title: string;
  description: string;
};

/** Acesso ao banco. Em produção é o Supabase (store.ts); nos testes, uma versão em memória. */
export interface ClosingStore {
  /** regra ligada que cobre o grupo, ou null */
  getFlowForGroup(groupId: string): Promise<ClosingFlow | null>;
  getFlow(id: string): Promise<ClosingFlow | null>;
  /** null: já existe uma pergunta em andamento neste grupo */
  createSurvey(s: NewSurvey): Promise<Survey | null>;
  /** cancela a pergunta agendada (ainda não enviada) do grupo; devolve quantas */
  cancelScheduled(groupId: string): Promise<number>;
  getSentSurvey(groupId: string): Promise<Survey | null>;
  findSentByPoll(pollWaId: string): Promise<Survey | null>;
  listDue(now: Date): Promise<Survey[]>;
  listExpired(now: Date): Promise<Survey[]>;
  markSent(id: string, info: { pollWaId: string; pollMessage: string; sentAt: Date; expiresAt: Date }): Promise<void>;
  markExpired(id: string): Promise<void>;
  /** só grava se ainda estiver 'sent': false quando outra resposta chegou antes */
  markAnswered(id: string, a: { label: string; index: number; by: string | null; at: Date }): Promise<boolean>;
  markFailed(id: string): Promise<void>;
  createAlert(alert: ClosingAlert): Promise<void>;
  /** o grupo volta a aparecer como pendente de resposta */
  reopenGroup(groupId: string, at: Date): Promise<void>;
}

export type TextRequest = { instanceId: string; jid: string; text: string; mentions?: string[] };
export type PollRequest = { instanceId: string; jid: string; question: string; options: string[] };

export interface ClosingSender {
  sendText(req: TextRequest): Promise<string>;
  /** devolve o id da enquete e a mensagem serializada (para abrir os votos depois) */
  sendPoll(req: PollRequest): Promise<{ id: string; message: string }>;
}
