/**
 * Validação da regra de mensagem de encerramento (0149): pergunta, opções e tempos.
 * Sem dependências, para as ações do servidor e os testes usarem o mesmo código.
 */
import { validateGroupIds, type Validation } from './automation-rules.ts';

export type ClosingOptionValue = { label: string; reply: string; reopen: boolean; notify: boolean };

export type ClosingFlowValues = {
  name: string;
  enabled: boolean;
  question: string;
  options: ClosingOptionValue[];
  groupIds: string[];
  delayMin: number;
  expireHours: number;
  notifyGroupJid: string | null;
  notifyGroupName: string | null;
  mentionJids: string[];
};

export type ClosingFlowInput = Partial<Record<keyof ClosingFlowValues, unknown>> & Record<string, unknown>;

const MENTION = /^\d{8,15}@(s\.whatsapp\.net|lid)$/;
export const MIN_OPTIONS = 2;
// o WhatsApp aceita até 12 opções numa enquete; 6 já é muito para uma pesquisa de encerramento
export const MAX_OPTIONS = 6;
export const MAX_LABEL = 100;
export const MAX_REPLY = 1000;

/** Opção em branco que o formulário usa ao adicionar uma nova linha. */
export const emptyOption = (): ClosingOptionValue => ({ label: '', reply: '', reopen: false, notify: false });

/** Modelo inicial: duas opções prontas, como "Sim, resolvido" e "Não, preciso de ajuda". */
export const DEFAULT_QUESTION = 'Seu atendimento foi resolvido?';
export const DEFAULT_OPTIONS: ClosingOptionValue[] = [
  { label: 'Sim, resolvido', reply: 'Que bom! Ficamos à disposição sempre que precisar. 🙂', reopen: false, notify: false },
  { label: 'Não, preciso de ajuda', reply: 'Sentimos muito! Já avisamos a equipe e vamos retomar o seu atendimento.', reopen: true, notify: true },
];

export function validateOptions(raw: unknown): Validation<ClosingOptionValue[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Informe as opções da pergunta.' };
  const options: ClosingOptionValue[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) return { ok: false, error: 'Toda opção precisa de um texto (é o que o cliente vê na enquete).' };
    if (label.length > MAX_LABEL) return { ok: false, error: `O texto de uma opção passa de ${MAX_LABEL} caracteres.` };
    const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
    if (reply.length > MAX_REPLY) return { ok: false, error: `A resposta de uma opção passa de ${MAX_REPLY} caracteres.` };
    if ((o.reopen !== undefined && typeof o.reopen !== 'boolean') || (o.notify !== undefined && typeof o.notify !== 'boolean')) {
      return { ok: false, error: 'Valor inválido numa opção.' };
    }
    options.push({ label, reply, reopen: o.reopen === true, notify: o.notify === true });
  }
  if (options.length < MIN_OPTIONS) return { ok: false, error: `Informe ao menos ${MIN_OPTIONS} opções.` };
  if (options.length > MAX_OPTIONS) return { ok: false, error: `No máximo ${MAX_OPTIONS} opções.` };
  const seen = new Set<string>();
  for (const o of options) {
    const key = o.label.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `A opção "${o.label}" está repetida.` };
    seen.add(key);
  }
  return { ok: true, value: options };
}

export function validateClosingFlow(input: ClosingFlowInput): Validation<ClosingFlowValues> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'Dê um nome à regra.' };
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return { ok: false, error: 'Escreva a pergunta enviada ao cliente.' };
  if (question.length > 200) return { ok: false, error: 'A pergunta passa de 200 caracteres.' };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return { ok: false, error: 'Valor inválido em enabled.' };

  const options = validateOptions(input.options);
  if (!options.ok) return options;

  const groups = validateGroupIds(input.groupIds);
  if (!groups.ok) return groups;

  const ints: Record<'delayMin' | 'expireHours', number> = { delayMin: 5, expireHours: 24 };
  for (const [key, label, min, max] of [
    ['delayMin', 'Enviar depois de (min)', 0, 1440],
    ['expireHours', 'Aguardar a resposta por (h)', 1, 720],
  ] as const) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
      return { ok: false, error: `${label}: informe um número inteiro entre ${min} e ${max}.` };
    }
    ints[key] = n;
  }

  const jidRaw = typeof input.notifyGroupJid === 'string' ? input.notifyGroupJid.trim() : '';
  if (jidRaw && !jidRaw.endsWith('@g.us')) return { ok: false, error: 'Grupo interno inválido.' };
  const notifyGroupJid = jidRaw || null;
  const needsNotify = options.value.some((o) => o.notify || o.reopen);
  if (needsNotify && !notifyGroupJid) {
    return { ok: false, error: 'Escolha o grupo interno: há opções que avisam a equipe ou reabrem o atendimento.' };
  }
  const notifyGroupName = notifyGroupJid && typeof input.notifyGroupName === 'string' ? input.notifyGroupName.trim().slice(0, 120) || null : null;

  const mentions = input.mentionJids ?? [];
  if (!Array.isArray(mentions) || mentions.length > 20 || !mentions.every((j) => typeof j === 'string' && MENTION.test(j))) {
    return { ok: false, error: 'Pessoas marcadas inválidas.' };
  }

  return {
    ok: true,
    value: {
      name: name.slice(0, 120),
      enabled: input.enabled !== false,
      question,
      options: options.value,
      groupIds: groups.value,
      delayMin: ints.delayMin,
      expireHours: ints.expireHours,
      notifyGroupJid,
      notifyGroupName,
      mentionJids: [...new Set(mentions as string[])],
    },
  };
}
