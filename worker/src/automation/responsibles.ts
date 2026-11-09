/**
 * Quem a cobrança marca como "responsáveis do grupo" (0158, 0162). Funções puras, sem banco, para testar.
 */

export type MemberLite = { id: string; phone: string | null; jid: string | null; active: boolean; user_email?: string | null };

const norm = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

/** Pessoas da equipe ativas cujo e-mail de acesso é de um administrador (0162). */
export function adminMemberIds(members: MemberLite[], adminEmails: string[]): string[] {
  const emails = new Set(adminEmails.map(norm).filter(Boolean));
  return members.filter((m) => m.active && emails.has(norm(m.user_email))).map((m) => m.id);
}

/** WhatsApp (jid) de uma pessoa: o descoberto pela conexão ou o telefone cadastrado; sem nenhum dos dois, null. */
export function memberJid(m: Pick<MemberLite, 'jid' | 'phone'>): string | null {
  if (m.jid) return m.jid;
  const digits = (m.phone ?? '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

/** Ids -> jids, só de gente ativa e com WhatsApp, sem repetir. */
export function jidsOf(ids: string[], members: MemberLite[]): string[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: string[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    const jid = m && m.active ? memberJid(m) : null;
    if (jid && !out.includes(jid)) out.push(jid);
  }
  return out;
}

/**
 * Responsáveis do grupo e do setor em WhatsApp. Com `adminIds` (opção "administradores são responsáveis por todos os
 * grupos"), eles entram junto dos responsáveis do grupo.
 */
export function resolveJids(opts: { groupIds: string[]; sectorIds: string[]; adminIds: string[]; members: MemberLite[] }): { group: string[]; sector: string[] } {
  return {
    group: jidsOf([...opts.groupIds, ...opts.adminIds], opts.members),
    sector: jidsOf(opts.sectorIds, opts.members),
  };
}
