import { createServer } from 'node:http';
import { runPeriodicChecks } from './alerts.js';
import { refreshCache } from './cache.js';
import { db } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { setWhatsAppSender } from './notify.js';
import { WhatsAppManager } from './whatsapp.js';

const ALERT_CHECK_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const startedAt = new Date();
let heartbeatWarned = false;

/** Informa ao painel que o worker está no ar (tabela worker_status). */
async function heartbeat(manager: WhatsAppManager) {
  const { error } = await db.from('worker_status').upsert({
    id: 'main',
    started_at: startedAt.toISOString(),
    last_seen_at: new Date().toISOString(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    whatsapp_version: manager.whatsappVersion(),
    info: { sessions: manager.status() },
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
