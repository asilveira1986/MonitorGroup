import { createHash } from 'node:crypto';
import type { WASocket } from 'baileys';
import { getSettings } from './cache.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { MEDIA_BUCKET } from './media.js';

/**
 * Fotos de perfil (participantes e imagem do grupo). O WhatsApp entrega a foto por um link que
 * expira, então o worker baixa a versão pequena e guarda no bucket privado. Uma fila por conexão,
 * uma foto de cada vez com intervalo, para não sobrecarregar o número; cada foto é atualizada a
 * cada 7 dias ou quando o WhatsApp avisa que mudou.
 */
const REFRESH_MS = 7 * 86_400_000;
const GAP_MS = 1_500;
const MAX_BYTES = 512 * 1024;

export const avatarPath = (companyId: string, jid: string) =>
  `${companyId}/avatars/${createHash('sha1').update(jid).digest('hex').slice(0, 20)}.jpg`;

/** Sem foto ou foto escondida pela privacidade do contato (não é falha). */
const isNoPicture = (err: unknown) => /item-not-found|not-authorized|404|401|forbidden/i.test(String((err as Error)?.message ?? err));

export class AvatarQueue {
  private pending = new Map<string, boolean>(); // jid -> forçar atualização
  private running = false;
  private stopped = false;

  constructor(
    private readonly companyId: string,
    private readonly sock: () => WASocket | null,
  ) {}

  /** Coloca na fila (force: o WhatsApp avisou que a foto mudou). */
  add(jids: (string | null | undefined)[], force = false) {
    for (const jid of jids) {
      if (!jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
      this.pending.set(jid, force || this.pending.get(jid) === true);
    }
    if (!this.running) void this.run();
  }

  stop() {
    this.stopped = true;
    this.pending.clear();
  }

  private async run() {
    this.running = true;
    try {
      while (this.pending.size && !this.stopped) {
        const settings = await getSettings(this.companyId);
        if (settings.avatars_enabled === false) {
          this.pending.clear();
          break;
        }
        // só os que ainda não foram vistos nos últimos 7 dias (ou forçados)
        const batch = [...this.pending.entries()].slice(0, 200);
        const { data, error } = await db
          .from('contact_avatars')
          .select('jid, checked_at')
          .eq('company_id', this.companyId)
          .in('jid', batch.map(([jid]) => jid));
        if (error) {
          // sem o script 0044 a tabela não existe: desiste em silêncio
          this.pending.clear();
          break;
        }
        const fresh = new Map((data ?? []).map((r) => [r.jid as string, Date.parse(r.checked_at as string)]));
        for (const [jid, force] of batch) {
          this.pending.delete(jid);
          if (this.stopped) break;
          if (!force && Date.now() - (fresh.get(jid) ?? 0) < REFRESH_MS) continue;
          await this.fetchOne(jid);
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
      }
    } catch (err) {
      logger.warn({ err }, 'falha na fila de fotos de perfil');
    } finally {
      this.running = false;
    }
  }

  private async fetchOne(jid: string) {
    const sock = this.sock();
    if (!sock) return;
    let path: string | null = null;
    try {
      const url = await sock.profilePictureUrl(jid, 'preview', 10_000);
      if (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`download ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= MAX_BYTES) {
          path = avatarPath(this.companyId, jid);
          const up = await db.storage.from(MEDIA_BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true });
          if (up.error) throw new Error(up.error.message);
        }
      }
    } catch (err) {
      if (!isNoPicture(err)) {
        logger.debug({ err, jid }, 'não foi possível buscar a foto de perfil');
        return; // tenta de novo numa próxima vez
      }
    }
    if (!path) {
      // ficou sem foto: apaga a antiga, se havia
      await db.storage.from(MEDIA_BUCKET).remove([avatarPath(this.companyId, jid)]).catch(() => undefined);
    }
    await db
      .from('contact_avatars')
      .upsert({ company_id: this.companyId, jid, path, checked_at: new Date().toISOString() }, { onConflict: 'company_id,jid' });
  }
}
