import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { twMerge } from 'tailwind-merge';

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

/** Junta classes CSS; em conflito (ex.: h-10 x h-8) vale a última. */
export const cn = (...classes: (string | false | null | undefined)[]) => twMerge(classes.filter(Boolean).join(' '));

export const ALERT_TYPE_LABEL: Record<string, string> = {
  no_response: 'Cliente sem resposta',
  keyword: 'Palavra-chave',
  high_volume: 'Volume alto',
  disconnected: 'WhatsApp desconectado',
  inactivity: 'Grupo sem movimentação',
  deadline_missed: 'Prazo prometido vencido',
  rework: 'Retrabalho',
  recurrence: 'Reincidência sem resposta',
  // automação de atendimento (0144)
  new_message: 'Nova mensagem',
  no_reply: 'Sem resposta',
};

export const DEMAND_STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export const DEMAND_SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  keyword: 'Comando/palavra-chave',
  ai: 'IA',
  commitment: 'Compromisso da equipe',
};

/** Categorias padrão de demanda (substituídas pelas do indicador "Tipo de demanda", se configurado). */
export const DEFAULT_DEMAND_TYPES = ['Financeiro', 'Erro', 'Dúvida', 'Pedido novo'];

export const SEVERITY_LABEL: Record<string, string> = {
  info: 'Informativo',
  warning: 'Atenção',
  critical: 'Crítico',
};

export const REMOVED_REASON_LABEL: Record<string, string> = {
  left: 'O número conectado saiu do grupo',
  removed: 'O número conectado foi removido do grupo',
  chat_deleted: 'A conversa do grupo foi apagada no celular',
  not_participant: 'O número não participa mais do grupo',
};

/** Demandas ligadas = pelo menos uma forma de criar demanda está ativa (Configurações › Demandas). */
export function demandsEnabled(
  s:
    | {
        demand_manual_enabled?: boolean | null;
        demand_command_enabled?: boolean | null;
        demand_keyword_enabled?: boolean | null;
        demand_ai_enabled?: boolean | null;
        demand_commitment_enabled?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (!s) return true;
  return Boolean(s.demand_manual_enabled || s.demand_command_enabled || s.demand_keyword_enabled || s.demand_ai_enabled || s.demand_commitment_enabled,
  );
}

/** Tamanho de arquivo para a tela: "320 KB" ou "4.2 MB". Vazio quando não se sabe. */
export const formatSize = (bytes: number | null | undefined) =>
  bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Iniciais (até 2) de um nome, para o avatar sem foto. `lettersOnly` ignora palavras que não começam com letra
 * (ex.: "+55", "(11)"); `fallback` é o que mostrar quando não sobra nenhuma letra.
 */
export function initials(name: string, opts: { lettersOnly?: boolean; fallback?: string } = {}): string {
  const { lettersOnly = false, fallback = '?' } = opts;
  const words = name.split(/\s+/).filter((w) => (lettersOnly ? /\p{L}/u.test(w[0] ?? '') : Boolean(w)));
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || fallback
  );
}

/** Iniciais de contatos e conversas: só letras, "#" quando o nome é só um número. */
export const CONTACT_INITIALS = { lettersOnly: true, fallback: '#' } as const;
