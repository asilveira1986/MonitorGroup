import { getBinaryNodeChild, getBinaryNodeChildren, isJidGroup, type BinaryNode } from 'baileys';

/**
 * Ids das mensagens de grupo que o próprio celular conectado leu ("read-self").
 * Devolve null para qualquer outra confirmação (entrega, leitura de terceiros etc.).
 */
export function selfReadIds(node: BinaryNode): string[] | null {
  const { type, from, id } = node.attrs ?? {};
  if ((type !== 'read-self' && type !== 'played-self') || !from || !isJidGroup(from)) return null;
  const list = getBinaryNodeChild(node, 'list');
  const more = list ? getBinaryNodeChildren(list, 'item').map((i) => i.attrs.id) : [];
  return [id, ...more].filter((x): x is string => !!x);
}
