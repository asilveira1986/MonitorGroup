/** Aviso do grupo de alertas fora do expediente (0139/0140): texto e envio, sem depender do banco. */

export type AfterHoursRow = {
  alert_group_id: string;
  group_id: string;
  group_name: string;
  pending_since: string;
  pending_count: number;
  /** limite em segundos: os minutos configurados ou o SLA do grupo */
  sla_seconds: number;
  waiting_seconds: number;
  who: string | null;
  body: string | null;
  message_type: string | null;
};

function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
}

/** Mensagem enviada no grupo de alertas. */
export function afterHoursNotice(r: AfterHoursRow, appUrl: string): string {
  const who = r.who ?? 'Cliente';
  const preview = r.body ? `\n${who}: "${r.body}"` : r.message_type && r.message_type !== 'text' ? `\n${who}: [${r.message_type}]` : '';
  return [
    '🚨 SLA estourado fora do expediente',
    `Grupo: ${r.group_name}`,
    `Sem resposta há ${duration(r.waiting_seconds)} (limite de ${duration(r.sla_seconds)}) · ${r.pending_count} mensagem(ns)${preview}`,
    appUrl ? `${appUrl}/groups/${r.group_id}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Avisa cada pendência no grupo de alertas e registra o que foi avisado. Quem falha ao enviar não é
 * registrado (tenta de novo na próxima verificação) e não impede os demais.
 */
export async function notifyAfterHours(
  companyId: string,
  rows: AfterHoursRow[],
  deps: {
    appUrl: string;
    send: (companyId: string, groupId: string, text: string) => Promise<void>;
    markNotified: (groupId: string, pendingSince: string) => Promise<void>;
    onError?: (err: unknown, row: AfterHoursRow) => void;
  },
): Promise<number> {
  let sent = 0;
  for (const r of rows) {
    try {
      await deps.send(companyId, r.alert_group_id, afterHoursNotice(r, deps.appUrl));
      await deps.markNotified(r.group_id, r.pending_since);
      sent++;
    } catch (err) {
      deps.onError?.(err, r);
    }
  }
  return sent;
}
