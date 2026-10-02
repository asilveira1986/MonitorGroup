import { createServer } from 'node:http';
import { runPeriodicChecks } from './alerts.js';
import { refreshCache } from './cache.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { setWhatsAppSender } from './notify.js';
import { WhatsAppManager } from './whatsapp.js';

const ALERT_CHECK_MS = 60_000;
const startedAt = new Date();

async function main() {
  await refreshCache(true);

  const manager = new WhatsAppManager();
  setWhatsAppSender((phone, text) => manager.sendText(phone, text));
  await manager.init();

  setInterval(() => void runPeriodicChecks(), ALERT_CHECK_MS);
  setInterval(() => void refreshCache(true), ALERT_CHECK_MS);

  // Healthcheck para a plataforma de hospedagem
  createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, startedAt, sessions: manager.status() }));
      return;
    }
    res.writeHead(404).end();
  }).listen(env.port, () => logger.info({ port: env.port }, 'worker do MonitorGroup no ar'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar o worker');
  process.exit(1);
});
