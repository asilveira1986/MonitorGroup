/** Aviso do grupo de alertas fora do expediente (0139/0140): texto e envio, sem depender do banco. */

export type AfterHoursRow = {
  alert_group_id: string;
  group_id: string;
  group_name: string;
  /** identificador do grupo no WhatsApp: o mesmo grupo existe uma vez por número conectado */
  group_jid: string | null;
  pending_since: string;
  pending_count: number;
  /** limite em segundos: os minutos configurados ou o SLA do grupo */
  sla_seconds: number;
  waiting_seconds: number;
  who: string | null;
  body: string | null;
  message_type: string | null;
  /** quando o cliente escreveu a última mensagem */
  last_client_at: string | null;
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
    '🚨 GRUPO SEM RESPOSTA',
    `Grupo: ${r.group_name}`,
    `Sem resposta há ${duration(r.waiting_seconds)} (limite de ${duration(r.sla_seconds)}) · ${r.pending_count} mensagem(ns)${preview}`,
    appUrl ? `${appUrl}/groups/${r.group_id}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Junta as cópias do mesmo grupo (uma por número conectado/setor): mesmo identificador do WhatsApp ou
 * mesmo nome. Cada grupo vira um só aviso, com a cópia que tem a última mensagem do cliente.
 */
export function groupAfterHours(rows: AfterHoursRow[]): { main: AfterHoursRow; members: AfterHoursRow[] }[] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    for (const key of [r.group_jid ? `jid:${r.group_jid}` : null, `name:${normalizeName(r.group_name)}`]) {
      if (!key) continue;
      const other = seen.get(key);
      if (other === undefined) seen.set(key, i);
      else parent[find(i)] = find(other);
    }
  });
  const clusters = new Map<number, AfterHoursRow[]>();
  rows.forEach((r, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), r]));
  return [...clusters.values()].map((members) => {
    const main = [...members].sort(
      (a, b) =>
        (b.last_client_at ?? '').localeCompare(a.last_client_at ?? '') || a.pending_since.localeCompare(b.pending_since),
    )[0];
    return { main, members };
  });
}

/**
 * Avisa cada grupo uma só vez no grupo de alertas e registra o aviso de todas as cópias dele. Quem falha
 * ao enviar não é registrado (tenta de novo na próxima verificação) e não impede os demais.
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
  for (const { main, members } of groupAfterHours(rows)) {
    try {
      await deps.send(companyId, main.alert_group_id, afterHoursNotice(main, deps.appUrl));
      for (const m of members) await deps.markNotified(m.group_id, m.pending_since);
      sent++;
    } catch (err) {
      deps.onError?.(err, main);
    }
  }
  return sent;
}
