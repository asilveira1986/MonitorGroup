import { db } from './db.js';
import { logger } from './logger.js';
import { MEDIA_BUCKET } from './media.js';

/**
 * Limpeza diária (0108): o que fica guardado sem uso. No banco, as filas de envio já resolvidas, as
 * confirmações de leitura antigas e o log com mais de 1 ano; no Storage, os arquivos que nada mais
 * usa (áudio já enviado, foto trocada, envio abandonado).
 */
const ORPHAN_BATCH = 500;
const ORPHAN_ROUNDS = 10;

/** Divide a lista em pedaços (a API do Storage apaga até algumas centenas por vez). */
export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function runDailyCleanup() {
  const { data, error } = await db.rpc('cleanup_old_data');
  if (error) {
    // banco sem o script 0108: nada a fazer
    if (!/cleanup_old_data/.test(error.message)) logger.warn({ err: error.message }, 'falha na limpeza diária do banco');
    return;
  }
  let files = 0;
  for (let round = 0; round < ORPHAN_ROUNDS; round++) {
    const { data: names, error: listError } = await db.rpc('storage_orphans', { p_limit: ORPHAN_BATCH });
    if (listError) {
      logger.warn({ err: listError.message }, 'falha ao listar os arquivos sem uso');
      break;
    }
    const list = (names ?? []) as string[];
    if (!list.length) break;
    let removed = 0;
    for (const part of chunks(list, 100)) {
      const res = await db.storage.from(MEDIA_BUCKET).remove(part);
      if (res.error) {
        logger.warn({ err: res.error.message }, 'falha ao apagar arquivos sem uso');
        break;
      }
      removed += part.length;
    }
    files += removed;
    if (removed < list.length) break;
  }
  logger.info({ ...(data as Record<string, number>), arquivos: files }, 'limpeza diária feita');
}
