import { digitsOnly, samePhone } from './text.js';

export type RecipientMember = {
  id: string;
  phone: string | null;
  user_email: string | null;
  alerts_own_groups_only: boolean;
};

/**
 * Para quem vai o alerta por WhatsApp e e-mail:
 *  - os números e e-mails da regra;
 *  - com "avisar os responsáveis do grupo", também o telefone e o e-mail de acesso de cada responsável;
 *  - quem está com "avisos só dos seus grupos" (Configurações › Equipe) só recebe alerta de grupo
 *    em que é responsável. Alerta sem grupo (ex.: WhatsApp desconectado) ou de grupo sem
 *    responsável vai para todos.
 */
export function alertRecipients(opts: {
  phones: string[];
  emails: string[];
  notifyResponsibles: boolean;
  groupId: string | null;
  responsibleIds: string[];
  members: RecipientMember[];
}): { phones: string[]; emails: string[] } {
  const { notifyResponsibles, groupId, responsibleIds, members } = opts;
  const responsible = new Set(groupId ? responsibleIds : []);
  let phones = opts.phones.map(digitsOnly).filter(Boolean);
  let emails = opts.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

  if (notifyResponsibles && groupId) {
    for (const m of members) {
      if (!responsible.has(m.id)) continue;
      const p = digitsOnly(m.phone);
      if (p) phones.push(p);
      if (m.user_email) emails.push(m.user_email.trim().toLowerCase());
    }
  }

  // grupo sem responsável: avisa todo mundo
  if (groupId && responsible.size > 0) {
    const restricted = members.filter((m) => m.alerts_own_groups_only && !responsible.has(m.id));
    phones = phones.filter((p) => !restricted.some((m) => m.phone && samePhone(p, digitsOnly(m.phone))));
    emails = emails.filter((e) => !restricted.some((m) => m.user_email?.trim().toLowerCase() === e));
  }

  const uniquePhones: string[] = [];
  for (const p of phones) if (!uniquePhones.some((q) => samePhone(p, q))) uniquePhones.push(p);
  return { phones: uniquePhones, emails: [...new Set(emails)] };
}
