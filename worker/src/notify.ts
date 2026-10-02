import { env } from './env.js';
import { logger } from './logger.js';
import type { AlertRule } from './db.js';
import { digitsOnly } from './text.js';

export type AlertPayload = {
  id: string;
  title: string;
  description: string;
  severity: string;
  type: string;
  groupName?: string | null;
  createdAt: string;
};

type WhatsAppSender = (phone: string, text: string) => Promise<void>;
let whatsappSender: WhatsAppSender | null = null;

export function setWhatsAppSender(sender: WhatsAppSender) {
  whatsappSender = sender;
}

const SEVERITY_LABEL: Record<string, string> = { info: 'ℹ️ Info', warning: '⚠️ Atenção', critical: '🚨 Crítico' };

function formatText(alert: AlertPayload) {
  const lines = [
    `${SEVERITY_LABEL[alert.severity] ?? alert.severity} - ${alert.title}`,
    alert.description,
  ];
  if (env.appUrl) lines.push(`${env.appUrl}/alerts`);
  return lines.filter(Boolean).join('\n');
}

/** Dispara a notificação do alerta em todos os canais configurados na regra. */
export async function sendNotifications(rule: AlertRule, alert: AlertPayload): Promise<string[]> {
  const delivered: string[] = [];
  if (rule.notify_in_app) delivered.push('in_app');
  const text = formatText(alert);

  const tasks: Promise<void>[] = [];

  if (rule.notify_emails?.length && env.resendApiKey) {
    tasks.push(
      sendEmail(rule.notify_emails, `[Monitor WhatsApp] ${alert.title}`, alert)
        .then(() => void delivered.push('email'))
        .catch((err) => logger.error({ err }, 'falha ao enviar e-mail de alerta')),
    );
  }

  if (rule.notify_whatsapp?.length && whatsappSender) {
    for (const phone of rule.notify_whatsapp) {
      tasks.push(
        whatsappSender(digitsOnly(phone), text)
          .then(() => {
            if (!delivered.includes('whatsapp')) delivered.push('whatsapp');
          })
          .catch((err) => logger.error({ err, phone }, 'falha ao enviar alerta por WhatsApp')),
      );
    }
  }

  if (rule.notify_webhook_url) {
    tasks.push(
      fetch(rule.notify_webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // "text" é compatível com Slack, Google Chat, Discord (content) e n8n/Zapier
        body: JSON.stringify({ text, content: text, alert }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          delivered.push('webhook');
        })
        .catch((err) => logger.error({ err }, 'falha ao chamar webhook de alerta')),
    );
  }

  await Promise.all(tasks);
  return delivered;
}

async function sendEmail(to: string[], subject: string, alert: AlertPayload) {
  const color = alert.severity === 'critical' ? '#d03b3b' : alert.severity === 'warning' ? '#d97706' : '#2a78d6';
  const link = env.appUrl
    ? `<p><a href="${env.appUrl}/alerts" style="background:#16a34a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir painel</a></p>`
    : '';
  const html = `
    <div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;margin:auto">
      <div style="border-left:4px solid ${color};padding:12px 16px;background:#f8fafc;border-radius:8px">
        <p style="margin:0;color:${color};font-weight:600">${SEVERITY_LABEL[alert.severity] ?? alert.severity}</p>
        <h2 style="margin:6px 0 8px">${escapeHtml(alert.title)}</h2>
        <p style="margin:0;white-space:pre-line;color:#334155">${escapeHtml(alert.description)}</p>
      </div>
      ${link}
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.alertEmailFrom, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
