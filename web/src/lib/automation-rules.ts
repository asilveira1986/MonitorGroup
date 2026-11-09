/**
 * Validação da automação de atendimento (0144): regras por grupo e telefones da equipe.
 * Sem dependências, para as ações do servidor e os testes usarem o mesmo código.
 */

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Etapa de cobrança (0158): a 1ª, a 2ª... Passando da última, repete a última. */
export type EscalationStep = {
  /** minutos desta cobrança (desde a mensagem, na 1ª; desde a cobrança anterior, nas demais); null = o geral da regra */
  waitMin: number | null;
  mentionGroupResponsibles: boolean;
  mentionSectorResponsibles: boolean;
  mentionJids: string[];
};

export const MAX_STEPS = 10;

/** Campos que o administrador pode editar numa regra. Qualquer outro campo recebido é ignorado. */
export type RuleValues = {
  enabled: boolean;
  ackEnabled: boolean;
  ackMessage: string;
  ackOffHours: string;
  ackCooldownMin: number;
  notifyGroupJid: string;
  notifyGroupName: string;
  escalateAfterMin: number;
  repeatEveryMin: number;
  maxEscalations: number;
  escalateOffHours: boolean;
  mentionJids: string[];
  escalationSteps: EscalationStep[];
  businessDays: number[];
  businessStart: string;
  businessEnd: string;
};

/** O que chega do formulário: pode trazer campos a mais (id, groupId...), que são ignorados. */
export type RuleInput = Partial<Record<keyof RuleValues, unknown>> & Record<string, unknown>;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 1000;
const MENTION = /^\d{8,15}@(s\.whatsapp\.net|lid)$/;

const INTEGER_FIELDS: { key: 'ackCooldownMin' | 'escalateAfterMin' | 'repeatEveryMin' | 'maxEscalations'; label: string }[] = [
  { key: 'ackCooldownMin', label: 'Intervalo entre acuses (min)' },
  { key: 'escalateAfterMin', label: 'Cobrar depois de (min)' },
  { key: 'repeatEveryMin', label: 'Repetir a cada (min)' },
  { key: 'maxEscalations', label: 'Máximo de cobranças' },
];

const BOOLEAN_FIELDS = ['enabled', 'ackEnabled', 'escalateOffHours'] as const;

/**
 * Valida os campos recebidos de uma regra. Na criação (`creating`), o grupo interno (notifyGroupJid) é
 * obrigatório; na edição, só os campos enviados são conferidos e devolvidos.
 */
export function validateRuleInput(input: RuleInput, opts: { creating: boolean }): Validation<Partial<RuleValues>> {
  const out: Partial<RuleValues> = {};

  for (const key of BOOLEAN_FIELDS) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') return { ok: false, error: `Valor inválido em ${key}.` };
    out[key] = input[key] as boolean;
  }

  for (const { key, label } of INTEGER_FIELDS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    const n = typeof input[key] === 'string' ? Number(String(input[key]).trim()) : input[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100_000) {
      return { ok: false, error: `${label}: informe um número inteiro maior ou igual a zero.` };
    }
    out[key] = n;
  }

  for (const key of ['ackMessage', 'ackOffHours'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') return { ok: false, error: `Texto inválido em ${key}.` };
    const text = (input[key] as string).trim();
    if (!text) return { ok: false, error: 'Escreva a mensagem do acuse (ou desligue o acuse).' };
    if (text.length > MAX_TEXT) return { ok: false, error: `A mensagem do acuse passa de ${MAX_TEXT} caracteres.` };
    out[key] = text;
  }

  for (const key of ['businessStart', 'businessEnd'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !HHMM.test((input[key] as string).trim())) {
      return { ok: false, error: 'Informe o horário no formato HH:MM (por exemplo, 08:00).' };
    }
    out[key] = (input[key] as string).trim();
  }

  if (input.businessDays !== undefined) {
    const days = input.businessDays;
    if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { ok: false, error: 'Dias de atendimento inválidos (0 = domingo ... 6 = sábado).' };
    }
    const unique = [...new Set(days as number[])].sort((a, b) => a - b);
    if (!unique.length) return { ok: false, error: 'Escolha ao menos um dia de atendimento.' };
    out.businessDays = unique;
  }

  if (input.mentionJids !== undefined) {
    const jids = input.mentionJids;
    if (!Array.isArray(jids) || jids.length > 20 || !jids.every((j) => typeof j === 'string' && MENTION.test(j))) {
      return { ok: false, error: 'Pessoas marcadas inválidas: use o número com DDI (por exemplo, 5551999998888).' };
    }
    out.mentionJids = [...new Set(jids as string[])];
  }

  if (input.escalationSteps !== undefined) {
    const steps = input.escalationSteps;
    if (!Array.isArray(steps) || steps.length > MAX_STEPS) return { ok: false, error: `Cobranças: no máximo ${MAX_STEPS} etapas.` };
    const clean: EscalationStep[] = [];
    for (const raw of steps as unknown[]) {
      const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      let waitMin: number | null = null;
      if (s.waitMin !== undefined && s.waitMin !== null && s.waitMin !== '') {
        const n = typeof s.waitMin === 'string' ? Number(s.waitMin.trim()) : s.waitMin;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100_000) {
          return { ok: false, error: 'Cobranças: o tempo de cada etapa precisa ser um número inteiro maior ou igual a zero.' };
        }
        waitMin = n;
      }
      const jids = s.mentionJids ?? [];
      if (!Array.isArray(jids) || jids.length > 20 || !jids.every((j) => typeof j === 'string' && MENTION.test(j))) {
        return { ok: false, error: 'Cobranças: pessoas marcadas inválidas.' };
      }
      clean.push({
        waitMin,
        mentionGroupResponsibles: s.mentionGroupResponsibles === true,
        mentionSectorResponsibles: s.mentionSectorResponsibles === true,
        mentionJids: [...new Set(jids as string[])],
      });
    }
    out.escalationSteps = clean;
  }

  if (input.notifyGroupJid !== undefined) {
    const jid = typeof input.notifyGroupJid === 'string' ? input.notifyGroupJid.trim() : '';
    if (!jid.endsWith('@g.us')) return { ok: false, error: 'Escolha o grupo interno que recebe os avisos.' };
    out.notifyGroupJid = jid;
  } else if (opts.creating) {
    return { ok: false, error: 'Escolha o grupo interno que recebe os avisos.' };
  }

  if (input.notifyGroupName !== undefined) {
    if (typeof input.notifyGroupName !== 'string' || !input.notifyGroupName.trim()) return { ok: false, error: 'Nome do grupo interno inválido.' };
    out.notifyGroupName = input.notifyGroupName.trim().slice(0, 120);
  }

  return { ok: true, value: out };
}

/** Grupos escolhidos para receber a mesma regra: de 1 a 500, sem repetir. */
export function validateGroupIds(ids: unknown): Validation<string[]> {
  if (!Array.isArray(ids)) return { ok: false, error: 'Escolha ao menos um grupo do cliente.' };
  const unique = [...new Set(ids)];
  if (!unique.length) return { ok: false, error: 'Escolha ao menos um grupo do cliente.' };
  if (unique.length > 500) return { ok: false, error: 'Escolha no máximo 500 grupos por vez.' };
  if (!unique.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) return { ok: false, error: 'Grupos inválidos.' };
  return { ok: true, value: unique as string[] };
}

/** Só os dígitos; vale com DDI + DDD + número (pelo menos 12 dígitos) e no máximo 15. */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

export const phoneToJid = (phone: string) => `${phone}@s.whatsapp.net`;

/** Nome e telefone de um atendente: o telefone com DDI e pelo menos 12 dígitos. */
export function validateTeamMember(input: { name?: unknown; phone?: unknown }): Validation<{ name: string; phone: string }> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'Informe o nome.' };
  const phone = normalizePhone(typeof input.phone === 'string' ? input.phone : '');
  if (!phone) return { ok: false, error: 'Telefone inválido: informe com DDI e DDD, por exemplo 5551999998888.' };
  return { ok: true, value: { name: name.slice(0, 120), phone } };
}
