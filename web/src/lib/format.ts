import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function timeAgo(date: string | null | undefined): string {
  if (!date) return '—';
  return formatDistanceToNowStrict(new Date(date), { locale: ptBR, addSuffix: true });
}

export function formatDateTime(date: string | null | undefined, timeZone?: string): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(date));
}

export function formatTime(date: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(date));
}

export const formatNumber = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR').format(n ?? 0);

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 13 || d.length === 12)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return `+${d}`;
}

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

export const ALERT_TYPE_LABEL: Record<string, string> = {
  no_response: 'Cliente sem resposta',
  keyword: 'Palavra-chave',
  high_volume: 'Volume alto',
  disconnected: 'WhatsApp desconectado',
  inactivity: 'Grupo sem movimentação',
};

export const SEVERITY_LABEL: Record<string, string> = {
  info: 'Informativo',
  warning: 'Atenção',
  critical: 'Crítico',
};

/** Meia-noite (no fuso informado) de `daysBack` dias atrás, como Date em UTC. */
export function startOfDayInTz(timeZone: string, daysBack = 0): Date {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+00:00';
  const midnight = new Date(`${ymd}T00:00:00${offset === '' ? '+00:00' : offset}`);
  midnight.setUTCDate(midnight.getUTCDate() - daysBack);
  return midnight;
}

export const secondsSince = (date: string) => (Date.now() - new Date(date).getTime()) / 1000;
