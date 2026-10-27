import { db } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { sendWhatsApp } from './notify.js';

/**
 * Avisos no WhatsApp da equipe (0106): novo compromisso, lembretes da agenda e nova demanda para o
 * responsável. O banco monta o texto e põe na fila; aqui o worker envia pelo WhatsApp da empresa.
 */
const SEND_EVERY_MS = 10_000;
const REMINDERS_EVERY_MS = 60_000;

type Row = { id: string; company_id: string; phone: string; body: string; link_path: string | null };

/** {link} vira o endereço da tela no painel (com APP_URL); sem APP_URL, some do texto. */
export function withLink(body: string, linkPath: string | null, appUrl: string): string {
  const link = appUrl && linkPath ? `${appUrl}${linkPath}` : '';
  return body.replaceAll('{link}', link).replace(/\n{3,}/g, '\n\n').trim();
}

let sending = false;

async function sendPending() {
  if (sending) return;
  sending = true;
  try {
    const { data, error } = await db.rpc('claim_team_whatsapp', { p_limit: 20 });
    if (error) {
      // banco sem o script 0106: nada a fazer
      if (!/claim_team_whatsapp/.test(error.message)) logger.warn({ err: error.message }, 'falha ao ler os avisos da equipe');
      return;
    }
    for (const row of (data ?? []) as Row[]) {
      try {
        await sendWhatsApp(row.company_id, row.phone, withLink(row.body, row.link_path, env.appUrl));
        await db.from('team_whatsapp_queue').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', row.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message, id: row.id }, 'falha ao enviar aviso no WhatsApp da equipe');
        await db.from('team_whatsapp_queue').update({ status: 'failed', error: message }).eq('id', row.id);
      }
    }
  } finally {
    sending = false;
  }
}

async function queueReminders() {
  const { error } = await db.rpc('queue_team_whatsapp_reminders');
  if (error && !/queue_team_whatsapp_reminders/.test(error.message)) logger.warn({ err: error.message }, 'falha ao agendar os lembretes no WhatsApp');
}

export function startTeamWhatsApp() {
  setInterval(() => void sendPending(), SEND_EVERY_MS);
  setInterval(() => void queueReminders(), REMINDERS_EVERY_MS);
  void queueReminders();
}
