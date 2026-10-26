import webpush from 'web-push';
import { db } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Notificações push (0098): os avisos entram em push_events pelo banco; aqui o worker gera as
 * chaves de envio (VAPID) na primeira vez, agenda os lembretes e manda cada aviso para os
 * aparelhos de quem deve receber.
 */
const SEND_EVERY_MS = 5_000;
const SCHEDULE_EVERY_MS = 60_000;

type Delivery = {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: { title: string; body: string | null; url: string; tag: string };
};

/** O que fazer com o aparelho depois do envio: 404/410 = a assinatura não existe mais. */
export function pushOutcome(statusCode: number | undefined): 'ok' | 'gone' | 'failed' {
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode === 404 || statusCode === 410) return 'gone';
  return 'failed';
}

let sending = false;
/** situação do envio, gravada no sinal de vida do worker (worker_status.info.push) para o diagnóstico */
let status = 'iniciando';
let lastRun: string | null = null;
export function pushStatus() {
  return { status, last_run: lastRun };
}

async function ensureKeys(): Promise<boolean> {
  const { data, error } = await db.from('push_config').select('public_key, private_key, subject').eq('id', 1).maybeSingle();
  if (error) {
    // banco sem o script 0098: segue sem push
    logger.warn({ err: error.message }, 'notificações push indisponíveis (execute o script 0098 no Supabase)');
    status = `sem chaves: ${error.message}`;
    return false;
  }
  let keys = data;
  if (!keys) {
    const generated = webpush.generateVAPIDKeys();
    const subject = env.appUrl.startsWith('https://') ? env.appUrl : 'mailto:suporte@monitorgroup.app';
    const { error: insertError } = await db
      .from('push_config')
      .upsert({ id: 1, public_key: generated.publicKey, private_key: generated.privateKey, subject }, { onConflict: 'id', ignoreDuplicates: true });
    if (insertError) {
      logger.warn({ err: insertError.message }, 'não foi possível gravar as chaves das notificações push');
      status = `sem chaves: ${insertError.message}`;
      return false;
    }
    const { data: saved } = await db.from('push_config').select('public_key, private_key, subject').eq('id', 1).maybeSingle();
    keys = saved;
    logger.info('chaves das notificações push geradas');
  }
  if (!keys) return false;
  webpush.setVapidDetails(keys.subject, keys.public_key, keys.private_key);
  return true;
}

async function sendPending() {
  if (sending) return;
  sending = true;
  try {
    const { data, error } = await db.rpc('claim_push_deliveries', { p_limit: 50 });
    if (error) {
      logger.warn({ err: error.message }, 'falha ao ler os avisos push');
      status = `erro ao ler a fila: ${error.message}`;
      return;
    }
    lastRun = new Date().toISOString();
    const deliveries = (data ?? []) as Delivery[];
    let failed = 0;
    await Promise.all(
      deliveries.map(async (d) => {
        let code: number | undefined;
        try {
          const res = await webpush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            JSON.stringify(d.payload),
            { TTL: 6 * 60 * 60, urgency: 'high', topic: topicOf(d.payload.tag) },
          );
          code = res.statusCode;
        } catch (err) {
          code = (err as { statusCode?: number }).statusCode;
          if (pushOutcome(code) === 'failed') {
            failed += 1;
            logger.warn({ status: code, err: (err as Error).message }, 'falha ao enviar push');
          }
        }
        const outcome = pushOutcome(code);
        await db.rpc('push_delivery_result', {
          p_subscription: d.subscription_id,
          p_ok: outcome === 'ok',
          p_gone: outcome === 'gone',
        });
      }),
    );
    if (deliveries.length) status = failed ? `${failed} de ${deliveries.length} envio(s) falharam no último ciclo` : 'ok';
    else if (status === 'iniciando' || status.startsWith('erro')) status = 'ok';
    // ainda tem fila: segue sem esperar o próximo ciclo
    if (deliveries.length >= 50) setTimeout(() => void sendPending(), 200);
  } catch (err) {
    logger.warn({ err }, 'falha no envio das notificações push');
    status = `erro no envio: ${(err as Error).message}`;
  } finally {
    sending = false;
  }
}

/** O "topic" substitui um aviso ainda não entregue com o mesmo assunto (até 32 caracteres seguros). */
function topicOf(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

async function queueScheduled() {
  const { error } = await db.rpc('queue_scheduled_pushes');
  if (error) {
    logger.warn({ err: error.message }, 'falha ao agendar os lembretes push');
    status = `erro nos lembretes: ${error.message}`;
  }
}

export async function startPush() {
  const ready = await ensureKeys().catch((err) => {
    logger.warn({ err }, 'notificações push indisponíveis');
    status = `sem chaves: ${(err as Error).message}`;
    return false;
  });
  // sem chaves (banco ainda sem o script, falha de rede...): tenta de novo em 1 minuto
  if (!ready) {
    setTimeout(() => void startPush(), SCHEDULE_EVERY_MS);
    return;
  }
  setInterval(() => void sendPending(), SEND_EVERY_MS);
  setInterval(() => void queueScheduled(), SCHEDULE_EVERY_MS);
  void queueScheduled();
  logger.info('notificações push no ar');
}
