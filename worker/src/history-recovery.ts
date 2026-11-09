/**
 * Recuperação de mensagens antigas de um grupo (0161, experimental).
 *
 * O WhatsApp permite que o aparelho conectado peça ao celular as mensagens ANTERIORES a uma mensagem âncora, até 50
 * por pedido. Esta função só decide o passeio para trás (de onde partir, quando parar, o que fazer se o celular não
 * responder); o envio do pedido e a gravação ficam por conta de quem chama (`fetchPage`), então ela é testada sem
 * WhatsApp.
 *
 * Parte da mensagem MAIS RECENTE já guardada e volta até o início do período pedido: assim cobre o buraco onde ele
 * estiver (as páginas que repetem mensagens já guardadas só custam tempo; a gravação ignora duplicadas).
 */

/** Mensagem de referência para o pedido ao celular. */
export type Cursor = { id: string; fromMe: boolean; participant?: string | null; at: number };

/** O que veio de um pedido. `null` no lugar dele: o celular não respondeu a tempo. */
export type Page = { found: number; added: number; oldest: Cursor | null };

export type RecoveryProgress = { requests: number; found: number; added: number; oldestAt: number | null };

export type RecoveryResult = RecoveryProgress & { status: 'done' | 'failed' | 'cancelled'; note: string };

export type RecoveryDeps = {
  /** início do período pedido (ms): para ao chegar nele */
  sinceMs: number;
  /** a mensagem mais recente guardada (ponto de partida); null = o grupo não tem nenhuma */
  anchor(): Promise<Cursor | null>;
  /** pede uma página ao celular e grava o que veio */
  fetchPage(cursor: Cursor): Promise<Page | null>;
  /** chamada depois de cada página (andamento na tela) */
  progress(p: RecoveryProgress): Promise<void>;
  /** o administrador cancelou? */
  isCancelled(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** limite de pedidos por execução (padrão 100: cerca de 5 mil mensagens) */
  maxPages?: number;
  /** pausa entre pedidos, para não parecer abuso ao WhatsApp (padrão 3 s) */
  delayMs?: number;
  /** quantas vezes seguidas o celular pode deixar de responder (padrão 2) */
  noReplyLimit?: number;
};

export async function runHistoryRecovery(deps: RecoveryDeps): Promise<RecoveryResult> {
  const maxPages = deps.maxPages ?? 100;
  const delayMs = deps.delayMs ?? 3000;
  const noReplyLimit = deps.noReplyLimit ?? 2;
  const total: RecoveryProgress = { requests: 0, found: 0, added: 0, oldestAt: null };
  const finish = (status: RecoveryResult['status'], note: string): RecoveryResult => ({ ...total, status, note });

  let cursor = await deps.anchor();
  if (!cursor) return finish('failed', 'O grupo não tem nenhuma mensagem guardada para servir de ponto de partida.');

  let noReply = 0;
  while (total.requests < maxPages) {
    if (await deps.isCancelled()) return finish('cancelled', 'Cancelado por um administrador.');
    total.requests++;
    const page = await deps.fetchPage(cursor);

    if (!page) {
      noReply++;
      await deps.progress({ ...total });
      if (noReply >= noReplyLimit) {
        return total.found > 0
          ? finish('done', 'O celular parou de responder. O que veio até aqui foi gravado; tente de novo mais tarde.')
          : finish('failed', 'O celular não respondeu. Ele precisa estar ligado, com internet e com o WhatsApp conectado.');
      }
      await deps.sleep(delayMs);
      continue; // tenta de novo a mesma página
    }
    noReply = 0;

    total.found += page.found;
    total.added += page.added;
    if (page.oldest) total.oldestAt = page.oldest.at;
    await deps.progress({ ...total });

    if (page.found === 0 || !page.oldest) return finish('done', 'O celular não tem mensagens mais antigas.');
    if (page.oldest.at >= cursor.at) return finish('done', 'O celular não devolveu mensagens mais antigas.');
    if (page.oldest.at <= deps.sinceMs) return finish('done', 'Chegou ao início do período pedido.');

    cursor = page.oldest;
    await deps.sleep(delayMs);
  }
  return finish('done', `Parou no limite de ${maxPages} pedidos. Peça de novo para continuar (o que já veio não se repete).`);
}
