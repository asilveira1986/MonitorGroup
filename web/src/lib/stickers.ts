/**
 * Figurinhas (0160): regras que o painel e o banco compartilham. Sem dependências, para as ações do servidor
 * e os testes usarem o mesmo código.
 */

/** Tamanho máximo de uma figurinha (o WhatsApp aceita até 1 MB; o banco também confere). */
export const MAX_STICKER_BYTES = 1024 * 1024;

export const STICKER_MIME = 'image/webp';

/** Pasta das figurinhas da empresa no Storage. */
export const stickerFolder = (companyId: string) => `${companyId}/stickers/`;

/** Caminho de uma figurinha nova da biblioteca. */
export const stickerPath = (companyId: string, id: string) => `${stickerFolder(companyId)}${id}.webp`;

/** O caminho está mesmo na biblioteca da empresa (e não dentro de outra pasta, nem com "..")? */
export function isStickerPath(companyId: string, path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith(stickerFolder(companyId)) &&
    !path.includes('..') &&
    /^[0-9a-f-]{36}\/stickers\/[0-9a-zA-Z._-]+$/i.test(path)
  );
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Confere o arquivo escolhido: .webp de até 1 MB. */
export function validateStickerFile(file: { mime?: unknown; size?: unknown }): Validation<{ mime: string; size: number }> {
  if (file.mime !== STICKER_MIME) return { ok: false, error: 'A figurinha precisa ser um arquivo .webp.' };
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: 'Arquivo vazio.' };
  if (file.size > MAX_STICKER_BYTES) return { ok: false, error: 'A figurinha passa de 1 MB.' };
  return { ok: true, value: { mime: STICKER_MIME, size: Math.round(file.size) } };
}

/** Nome para mostrar: o dado, ou o arquivo sem a extensão, limitado a 80 caracteres. */
export function stickerName(raw: unknown, fallback = ''): string | null {
  const text = typeof raw === 'string' ? raw : fallback;
  const name = text.replace(/\.webp$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || null;
}
