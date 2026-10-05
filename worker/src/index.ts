import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { runPeriodicChecks } from './alerts.js';
import { refreshCache } from './cache.js';
import { db } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { setWhatsAppSender } from './notify.js';
import { WhatsAppManager } from './whatsapp.js';

const ALERT_CHECK_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const LOCK_TTL_S = 45;
const LOCK_RENEW_MS = 15_000;
const startedAt = new Date();
let heartbeatWarned = false;

/** Identifica esta cópia do worker (a trava garante que só uma usa o WhatsApp). */
const workerId = randomUUID();
const host = process.env.RAILWAY_REPLICA_ID
  ? `railway:${process.env.RAILWAY_REPLICA_ID.slice(0, 8)}`
  : process.env.RAILWAY_ENVIRONMENT_NAME
    ? `railway:${hostname()}`
    : hostname();
let role: 'waiting' | 'active' = 'waiting';
let waitingFor: string | null = null;

type LockResult = { acquired: boolean; holder: string; host: string | null } | null;

/** Pega/renova a trava. null = script 0013 ainda não executado (segue sem trava). */
async function acquireLock(): Promise<LockResult> {
  const { data, error } = await db.rpc('acquire_worker_lock', { p_holder: workerId, p_host: host, p_ttl_seconds: LOCK_TTL_S });
  if (error) {
    if (/acquire_worker_lock|schema cache|does not exist/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data as LockResult;
}

/** Informa ao painel que o worker está no ar (tabela worker_status). */
async function heartbeat(manager: WhatsAppManager) {
  const { error } = await db.from('worker_status').upsert({
    // a cópia que aguarda a trava aparece à parte, para o painel avisar da duplicidade
    id: role === 'active' ? 'main' : 'standby',
    started_at: startedAt.toISOString(),
    last_seen_at: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    whatsapp_version: manager.whatsappVersion(),
    info: { sessions: manager.status(), host, waiting_for: role === 'waiting' ? waitingFor : null },
  });
  if (error && !heartbeatWarned) {
    heartbeatWarned = true;
    logger.warn({ error: error.message }, 'não foi possível registrar o sinal de vida (execute o script 0005 no Supabase)');
  }
}

async function main() {
  const manager = new WhatsAppManager();

  // Healthcheck para a plataforma de hospedagem (sobe primeiro)
  createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, startedAt, sessions: manager.status() }));
      return;
    }
    res.writeHead(404).end();
  }).listen(env.port, () => logger.info({ port: env.port }, 'servidor de healthcheck no ar'));

  try {
    await refreshCache(true);
  } catch (err) {
    logger.fatal(
      { err },
      'não foi possível ler o banco. Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY e se os scripts SQL foram executados',
    );
    process.exit(1);
  }

  // só uma cópia do worker conecta ao WhatsApp; as demais aguardam
  let lock = await acquireLock();
  if (lock === null) {
    logger.warn('trava de worker indisponível (execute o script 0013 no Supabase); seguindo sem ela');
  } else if (!lock.acquired) {
    waitingFor = lock.host;
    logger.warn({ holder: lock.host }, 'outro worker está usando o WhatsApp; aguardando a vez');
    await heartbeat(manager);
    const waitBeat = setInterval(() => void heartbeat(manager).catch(() => {}), HEARTBEAT_MS);
    while (!lock?.acquired) {
      await new Promise((r) => setTimeout(r, 5_000));
      lock = await acquireLock().catch(() => lock);
      if (lock && !lock.acquired) waitingFor = lock.host;
    }
    clearInterval(waitBeat);
    logger.info('trava obtida: este worker passa a usar o WhatsApp');
  }
  role = 'active';
  // a cópia "standby" deixou de existir
  await db.from('worker_status').delete().eq('id', 'standby');

  if (lock !== null) {
    setInterval(() => {
      void acquireLock()
        .then((l) => {
          if (l && !l.acquired) {
            // outra cópia assumiu (ex.: este processo ficou travado): sai para não brigar pela sessão
            logger.error({ holder: l.host }, 'trava perdida para outro worker; encerrando');
            void manager.shutdown().finally(() => process.exit(1));
          }
        })
        .catch((err) => logger.warn({ err }, 'falha ao renovar a trava do worker'));
    }, LOCK_RENEW_MS);
  }

  // deploy/parada: fecha a conexão sem deslogar e libera a trava para a nova versão assumir na hora
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'encerrando o worker');
    await manager.shutdown().catch(() => {});
    await db.rpc('release_worker_lock', { p_holder: workerId }).then(() => undefined, () => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await heartbeat(manager);
  setInterval(() => void heartbeat(manager).catch(() => {}), HEARTBEAT_MS);

  setWhatsAppSender((phone, text) => manager.sendText(phone, text));
  await manager.init();

  setInterval(() => void runPeriodicChecks(), ALERT_CHECK_MS);
  setInterval(() => void refreshCache(true), ALERT_CHECK_MS);
  logger.info('worker do MonitorGroup no ar');
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar o worker');
  process.exit(1);
});
