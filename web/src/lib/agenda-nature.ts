/** Natureza do compromisso da agenda (0168): particular ou profissional, escolha obrigatória. */
export type EventNature = 'professional' | 'personal';

export const NATURES: { key: EventNature; label: string }[] = [
  { key: 'professional', label: 'Profissional' },
  { key: 'personal', label: 'Particular' },
];

export const natureLabel = (n: EventNature | null | undefined) => NATURES.find((x) => x.key === n)?.label ?? null;

export const isNature = (v: unknown): v is EventNature => v === 'professional' || v === 'personal';

/** Mensagem quando falta escolher (formulário e servidor usam a mesma). */
export const NATURE_REQUIRED = 'Escolha se o compromisso é particular ou profissional.';
