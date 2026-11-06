import { createHash } from 'node:crypto';
import { BufferJSON, decryptPollVote, jidNormalizedUser } from 'baileys';

/** Serializa a mensagem da enquete (com o segredo da criptografia dos votos) para guardar no banco. */
export const serializePollMessage = (message: unknown): string => JSON.stringify(message, BufferJSON.replacer);
export const parsePollMessage = (raw: string): Record<string, unknown> => JSON.parse(raw, BufferJSON.reviver);

type PollCreation = { options?: { optionName?: string | null }[] | null };

/** Opções da enquete criada (nomes), na ordem em que foram enviadas. */
export function pollOptionNames(message: Record<string, unknown>): string[] {
  const m = message as { pollCreationMessage?: PollCreation; pollCreationMessageV2?: PollCreation; pollCreationMessageV3?: PollCreation };
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  return (poll?.options ?? []).map((o) => o.optionName ?? '');
}

const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex');

/** Índice da opção escolhida a partir dos hashes do voto (null: voto removido ou opção desconhecida). */
export function selectedIndex(names: string[], selected: Uint8Array[]): number | null {
  const first = selected[0];
  if (!first) return null;
  const hex = Buffer.from(first).toString('hex');
  const i = names.findIndex((n) => sha256(n) === hex);
  return i >= 0 ? i : null;
}

/**
 * Decifra um voto. O WhatsApp pode identificar quem criou a enquete e quem votou pelo número ou pelo LID:
 * tenta as combinações possíveis até uma funcionar.
 */
export function decodeVote(opts: {
  pollMessage: Record<string, unknown>;
  pollWaId: string;
  vote: { encPayload?: Uint8Array | null; encIv?: Uint8Array | null };
  creatorJids: (string | null | undefined)[];
  voterJids: (string | null | undefined)[];
}): number | null {
  const secret = (opts.pollMessage as { messageContextInfo?: { messageSecret?: Uint8Array | null } }).messageContextInfo?.messageSecret;
  if (!secret || !opts.vote.encPayload || !opts.vote.encIv) return null;
  const names = pollOptionNames(opts.pollMessage);
  const norm = (j: string | null | undefined) => (j ? jidNormalizedUser(j) : null);
  for (const creator of new Set(opts.creatorJids.map(norm).filter(Boolean) as string[])) {
    for (const voter of new Set(opts.voterJids.map(norm).filter(Boolean) as string[])) {
      try {
        const v = decryptPollVote(
          { encPayload: opts.vote.encPayload, encIv: opts.vote.encIv },
          { pollCreatorJid: creator, pollMsgId: opts.pollWaId, pollEncKey: secret, voterJid: voter },
        );
        return selectedIndex(names, (v.selectedOptions ?? []) as Uint8Array[]);
      } catch {
        /* combinação errada: tenta a próxima */
      }
    }
  }
  return null;
}
