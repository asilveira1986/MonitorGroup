// Assinatura "*Nome:*" das mensagens (funções puras, sem banco: testadas à parte).

/** Nome sem acento, em minúsculas e com um espaço só (para comparar assinaturas). */
export function signatureKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Quem assinou a mensagem ("*Nome:*" na primeira linha), se for o nome de alguém da equipe. */
export function signedName(body: string | null | undefined): string | null {
  const m = /^\*([^*\n]{2,80}):\*\s*\n/.exec(body ?? '');
  return m ? m[1].trim() : null;
}
