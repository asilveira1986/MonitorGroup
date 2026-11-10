/**
 * Pendência da conversa por regras (0167): como mostrar no Painel de grupos (etiqueta) e na tela do grupo (linha).
 * O cálculo é do worker (worker/src/followup.ts); aqui só a apresentação.
 */

export type FollowupInfo = {
  followup_status?: 'company' | 'client' | 'resolved' | null;
  followup_kind?: string | null;
  followup_reason?: string | null;
  followup_excerpt?: string | null;
  followup_trigger?: string | null;
  followup_since?: string | null;
  followup_due_at?: string | null;
  followup_actor?: string | null;
  followup_dismissed_by?: string | null;
};

export type FollowupBadge = {
  side: 'company' | 'client';
  /** "Pendente empresa" / "Pendente cliente" */
  label: string;
  overdue: boolean;
  /** dica com o motivo, o trecho e o prazo */
  title: string;
};

export type FollowupFilter = 'all' | 'company' | 'client' | 'overdue';

export const FOLLOWUP_FILTERS: { value: FollowupFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'company', label: 'Pendente empresa' },
  { value: 'client', label: 'Pendente cliente' },
  { value: 'overdue', label: 'Prazo vencido' },
];

const SIDE = { company: 'Pendente empresa', client: 'Pendente cliente' } as const;

/** Etiqueta do cartão; null quando não há pendência. */
export function followupBadge(f: FollowupInfo, now: number, fmt: (iso: string) => string = (iso) => iso): FollowupBadge | null {
  const side = f.followup_status;
  if (side !== 'company' && side !== 'client') return null;
  const overdue = Boolean(f.followup_due_at && new Date(f.followup_due_at).getTime() < now);
  const parts = [
    f.followup_reason ?? SIDE[side],
    f.followup_excerpt ? `“${f.followup_excerpt}”${f.followup_actor ? ` (${f.followup_actor})` : ''}` : null,
    f.followup_due_at ? `Prazo: ${fmt(f.followup_due_at)}${overdue ? ' (vencido)' : ''}` : null,
  ].filter(Boolean);
  return { side, label: SIDE[side], overdue, title: parts.join(' · ') };
}

/** O grupo entra no filtro de pendência escolhido? */
export function matchesFollowup(f: FollowupInfo, filter: FollowupFilter, now: number): boolean {
  if (filter === 'all') return true;
  const b = followupBadge(f, now);
  if (!b) return false;
  return filter === 'overdue' ? b.overdue : b.side === filter;
}
