'use client';

import { AlertOctagon, ArrowUpRight, CheckCircle2, Hourglass, MinusCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui';
import { cn, formatDuration, formatNumber } from '@/lib/format';

export type PanelStatus = 'late' | 'waiting' | 'answered' | 'neutral';

export type PanelGroup = {
  id: string;
  name: string;
  status: PanelStatus;
  received_today: number;
  answers_today: number;
  team_today: number;
  pending_count: number;
  pending_since: string | null;
  waiting_seconds: number | null;
  waiting_counted_seconds: number | null;
  sla_seconds: number;
  business_time: boolean;
  last_message_at: string | null;
  messages: { who: string; body: string | null; type: string; at: string; pending: boolean }[];
  last_reply: { who: string; at: string; response_seconds: number | null } | null;
};

const STATUS: Record<
  PanelStatus,
  { label: string; filter: string; icon: typeof AlertOctagon; card: string; badge: string; dot: string }
> = {
  late: {
    label: 'Tempo de resposta excedido',
    filter: 'Atrasados',
    icon: AlertOctagon,
    card: 'border-critical/60 bg-critical/[0.07] ring-1 ring-critical/30',
    badge: 'bg-critical text-white',
    dot: 'bg-critical',
  },
  waiting: {
    label: 'Aguardando resposta',
    filter: 'Aguardando',
    icon: Hourglass,
    card: 'border-warning/60 bg-warning/[0.07]',
    badge: 'bg-warning/20 text-warning-ink',
    dot: 'bg-warning',
  },
  answered: {
    label: 'Tudo respondido hoje',
    filter: 'Respondidos',
    icon: CheckCircle2,
    card: 'border-good/50 bg-good/[0.06]',
    badge: 'bg-good/15 text-good-ink',
    dot: 'bg-good',
  },
  neutral: {
    label: 'Sem mensagens hoje',
    filter: 'Sem mensagens',
    icon: MinusCircle,
    card: 'border-line bg-surface',
    badge: 'bg-surface-2 text-muted',
    dot: 'bg-muted/50',
  },
};
const ORDER: PanelStatus[] = ['late', 'waiting', 'answered', 'neutral'];

const TYPE_LABEL: Record<string, string> = {
  image: '📷 Imagem',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: '🙂 Figurinha',
};

/** Hora (hoje) ou dia e hora (dias anteriores). */
function when(date: string, timeZone: string, today: string) {
  const d = new Date(date);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(d);
  if (ymd === today) return time;
  return `${new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(d)} ${time}`;
}

/** Cartão de um grupo. */
function GroupCard({ g, timeZone, today, now }: { g: PanelGroup; timeZone: string; today: string; now: number }) {
  const s = STATUS[g.status];
  const pending = g.pending_since != null;
  // espera ao vivo (o tempo contado para o SLA vem do servidor; o corrido avança aqui)
  const waiting = pending ? Math.max(0, (now - new Date(g.pending_since!).getTime()) / 1000) : null;
  const counted = g.waiting_counted_seconds ?? 0;
  const progress = pending ? Math.min(100, Math.round((counted / Math.max(1, g.sla_seconds)) * 100)) : 0;

  return (
    <article className={cn('flex flex-col rounded-2xl border p-4 shadow-sm transition', s.card)}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink" title={g.name}>
            {g.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Hoje: {formatNumber(g.received_today)} recebida(s) · {formatNumber(g.answers_today)} resposta(s)
          </p>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', s.badge)}>
          <s.icon className="h-3.5 w-3.5" aria-hidden />
          {g.status === 'late' ? 'Atrasado' : g.status === 'waiting' ? 'Aguardando' : g.status === 'answered' ? 'Respondido' : 'Sem mensagens'}
        </span>
      </header>

      {/* espera em relação ao tempo de resposta */}
      {pending && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className={cn('font-semibold', g.status === 'late' ? 'text-critical-ink' : 'text-warning-ink')}>
              {g.pending_count} sem resposta · esperando há {formatDuration(waiting)}
            </span>
            <span className="shrink-0 text-muted">
              SLA {formatDuration(g.sla_seconds)}
              {g.business_time ? ' úteis' : ''}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className={cn('h-full rounded-full', g.status === 'late' ? 'bg-critical' : 'bg-warning')}
              style={{ width: `${Math.max(progress, 4)}%` }}
            />
          </div>
        </div>
      )}

      {/* últimas mensagens recebidas */}
      <ul className="mt-3 flex-1 space-y-1.5 text-xs">
        {g.messages.length === 0 && <li className="text-muted">Nenhuma mensagem de cliente ainda.</li>}
        {g.messages.map((m, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 whitespace-nowrap tabular text-muted">{when(m.at, timeZone, today)}</span>
            <span className={cn('min-w-0 flex-1 truncate', m.pending ? 'text-ink' : 'text-ink-2')}>
              {m.pending && (
                <span
                  className={cn('mr-1 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle', s.dot)}
                  aria-label="sem resposta"
                />
              )}
              <span className="font-medium">{m.who}:</span>{' '}
              {m.type !== 'text' && <span className="text-muted">{TYPE_LABEL[m.type] ?? m.type} </span>}
              {m.body}
            </span>
          </li>
        ))}
      </ul>

      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-2.5">
        <span className="min-w-0 truncate text-[11px] text-muted">
          {g.last_reply
            ? `Última resposta: ${g.last_reply.who} · ${when(g.last_reply.at, timeZone, today)}`
            : 'A equipe ainda não respondeu neste grupo'}
        </span>
        <Link
          href={`/groups/${g.id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-2 hover:border-brand hover:text-brand"
        >
          Ver grupo <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </footer>
    </article>
  );
}

/**
 * Grade de cartões com filtro por situação e busca por nome.
 * Atualiza sozinha: a cada mensagem nova (tempo real do app) e a cada minuto,
 * para o cartão ficar vermelho quando o tempo de resposta é excedido.
 */
export function GroupsPanel({ groups, timeZone }: { groups: PanelGroup[]; timeZone: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<PanelStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => router.refresh(), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const counts = useMemo(
    () => Object.fromEntries(ORDER.map((k) => [k, groups.filter((g) => g.status === k).length])) as Record<PanelStatus, number>,
    [groups],
  );
  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => (filter === 'all' || g.status === filter) && (!q || g.name.toLowerCase().includes(q)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium',
              filter === 'all' ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:text-ink',
            )}
          >
            Todos <span className="tabular opacity-70">{groups.length}</span>
          </button>
          {ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(filter === k ? 'all' : k)}
              aria-pressed={filter === k}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                filter === k ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:text-ink',
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', STATUS[k].dot)} aria-hidden />
              {STATUS[k].filter} <span className="tabular opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar grupo"
            aria-label="Buscar grupo"
            className="h-9 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<Search />} title="Nenhum grupo" description="Nenhum grupo com essa situação ou esse nome." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5">
          {shown.map((g) => (
            <GroupCard key={g.id} g={g} timeZone={timeZone} today={today} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
