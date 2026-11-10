/** Histórico do atendimento de uma conversa privada (0164): assumiu, transferiu, liberou, finalizou. */
export type PrivateChatEventType = 'assigned' | 'released' | 'transferred' | 'finished';

export type PrivateChatEvent = {
  id: string;
  chat_id: string;
  user_id: string | null;
  type: PrivateChatEventType;
  note: string | null;
  /** nomes da época (by_name, from_name, to_name), ids (from, to), customer, reopened, via */
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Quem perdeu a conversa (liberação) ou de quem ela saiu (transferência). */
export function eventFrom(e: Pick<PrivateChatEvent, 'metadata'>): string | null {
  return str(e.metadata?.from);
}

/**
 * Texto da linha do histórico. `me` troca o próprio nome por "Você".
 * Ex.: "Ana liberou a conversa de Bia — motivo: cliente pediu outro atendente".
 */
export function eventText(e: Pick<PrivateChatEvent, 'type' | 'note' | 'metadata' | 'user_id'>, me?: string): string {
  const m = e.metadata ?? {};
  const name = (id: unknown, label: unknown, fallback: string) => (me && id === me ? 'você' : (str(label) ?? fallback));
  const by = me && e.user_id === me ? 'Você' : (str(m.by_name) ?? 'O sistema');
  const from = name(m.from, m.from_name, 'outro usuário');
  const to = name(m.to, m.to_name, 'outro usuário');
  const note = str(e.note);
  switch (e.type) {
    case 'released':
      return `${by} liberou a conversa de ${from}${note ? ` — motivo: ${note}` : ''}`;
    case 'transferred':
      return `${by} transferiu a conversa${str(m.from) ? ` de ${from}` : ''} para ${to}${note ? ` — obs.: ${note}` : ''}`;
    case 'finished':
      return `${by} finalizou o atendimento`;
    case 'assigned':
      return m.reopened ? `${by} reabriu o atendimento` : `${by} assumiu a conversa`;
    default:
      return `${by} alterou o atendimento`;
  }
}
