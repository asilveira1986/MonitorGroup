/**
 * Fechamento da conversa: reconhece a mensagem rápida de fechamento (\fechamento) enviada pela
 * equipe, também quando enviada pelo celular. O texto da mensagem rápida tem partes fixas e itens
 * trocados na hora ({saudacao}, {cliente}...): a mensagem é de fechamento quando traz todas as
 * partes fixas, na ordem, sem diferenciar acentos, maiúsculas e pontuação.
 */

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Partes fixas do modelo que identificam o fechamento (curtas demais não contam). */
export function closingChunks(template: string | null | undefined): string[] {
  if (!template) return [];
  return template
    .split(/\{\w+\}/g)
    .map(normalize)
    .filter((c) => c.length >= 8 || c.split(' ').length >= 2);
}

/** A mensagem da equipe é o texto de fechamento? */
export function isClosingMessage(body: string | null | undefined, template: string | null | undefined): boolean {
  const chunks = closingChunks(template);
  if (!body || !chunks.length) return false;
  const text = ` ${normalize(body)} `;
  let from = 0;
  for (const c of chunks) {
    const at = text.indexOf(` ${c} `, from);
    if (at < 0) return false;
    from = at + c.length + 1;
  }
  return true;
}
