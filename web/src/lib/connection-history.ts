/**
 * Histórico de desconexões dos números de WhatsApp (0195): períodos fora do ar e o resumo dos últimos dias.
 * Sem dependências, para a tela e os testes usarem a mesma conta.
 */
export type ConnectionPeriod = {
  id: string;
  instance_id: string;
  started_at: string;
  /** vazio = ainda desconectado */
  ended_at: string | null;
  reason: string | null;
};

/** Duração do período em segundos (o que está aberto vai até `now`). */
export function periodSeconds(p: Pick<ConnectionPeriod, 'started_at' | 'ended_at'>, now: number): number {
  const end = p.ended_at ? new Date(p.ended_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(p.started_at).getTime()) / 1000));
}

/**
 * Tempo fora do ar nos últimos `days` dias, de um número (ou de todos, sem `instanceId`): soma só a parte de cada período que
 * cai dentro da janela. `count` = quedas que começaram na janela.
 */
export function offlineSummary(periods: ConnectionPeriod[], now: number, days: number, instanceId?: string): { seconds: number; count: number; share: number } {
  const from = now - days * 86_400_000;
  let ms = 0;
  let count = 0;
  for (const p of periods) {
    if (instanceId && p.instance_id !== instanceId) continue;
    const start = new Date(p.started_at).getTime();
    const end = p.ended_at ? new Date(p.ended_at).getTime() : now;
    if (end <= from) continue;
    ms += Math.max(0, end - Math.max(start, from));
    if (start >= from) count += 1;
  }
  return { seconds: Math.round(ms / 1000), count, share: Math.min(1, ms / (days * 86_400_000)) };
}

/** Motivo para mostrar; sem motivo registrado, um texto padrão. */
export function reasonText(reason: string | null): string {
  const r = (reason ?? '').trim();
  return r || 'Motivo não informado';
}
