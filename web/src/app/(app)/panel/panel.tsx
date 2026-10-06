'use client';

import { AlertOctagon, CheckCircle2, Clock, Hourglass, MinusCircle, Search } from 'lucide-react';
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

/** Cartão compacto: nome do grupo, mensagens recebidas hoje e, se houver, quantas estão sem resposta. Clicar abre o grupo. */
function GroupCard({ g, now }: { g: PanelGroup; now: number }) {
  const s = STATUS[g.status];
  const since = (iso: string) => Math.max(0, (now - new Date(iso).getTime()) / 1000);
  // atrasado: tempo além do SLA (em tempo útil, se essa regra estiver ligada); aguardando: espera; senão: última mensagem
  let time: { label: string; value: string; title: string } | null = null;
  if (g.pending_since && g.status === 'late') {
    const counted = g.business_time ? (g.waiting_counted_seconds ?? 0) : since(g.pending_since);
    time = {
      label: 'atraso',
      value: formatDuration(Math.max(0, counted - g.sla_seconds)),
      title: `Esperando há ${formatDuration(since(g.pending_since))} · SLA ${formatDuration(g.sla_seconds)}${g.business_time ? ' úteis' : ''}`,
    };
  } else if (g.pending_since) {
    time = {
      label: 'espera',
      value: formatDuration(since(g.pending_since)),
      title: `Cliente esperando resposta · SLA ${formatDuration(g.sla_seconds)}${g.business_time ? ' úteis' : ''}`,
    };
  } else if (g.last_message_at) {
    time = { label: 'há', value: formatDuration(since(g.last_message_at)), title: 'Tempo desde a última mensagem do grupo' };
  }
  return (
    <Link
      href={`/groups/${g.id}`}
      title={`${g.name} · ${s.label}`}
      className={cn(
        'flex min-h-[5.5rem] flex-col justify-between rounded-xl border p-3 shadow-sm transition hover:-translate-y-px hover:shadow-md',
        s.card,
      )}
    >
      <div>
        <div className="flex items-start gap-1.5">
          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', s.dot)} aria-hidden />
          <h3 className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug text-ink">{g.name}</h3>
        </div>
        {time && (
          <p
            className={cn(
              'mt-0.5 flex items-center gap-1 pl-3.5 text-[11px] tabular',
              g.status === 'late' ? 'font-semibold text-critical-ink' : g.status === 'waiting' ? 'font-semibold text-warning-ink' : 'text-muted',
            )}
            title={time.title}
            suppressHydrationWarning
          >
            <Clock className="h-3 w-3 shrink-0" aria-hidden />
            {time.label} {time.value}
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="whitespace-nowrap text-xs text-ink-2">
          <span className="text-base font-semibold tabular text-ink">{formatNumber(g.received_today)}</span>{' '}
          {g.received_today === 1 ? 'mensagem hoje' : 'mensagens hoje'}
        </p>
        {g.pending_count > 0 && (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', s.badge)}>
            <s.icon className="h-3 w-3" aria-hidden />
            {g.pending_count} sem resposta
          </span>
        )}
      </div>
    </Link>
  );
}

/**
 * Grade de cartões com filtro por situação e busca por nome.
 * Atualiza sozinha: a cada mensagem nova (tempo real do app) e a cada minuto,
 * para o cartão ficar vermelho quando o tempo de resposta é excedido.
 */
export function GroupsPanel({ groups }: { groups: PanelGroup[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<PanelStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  // relógio dos tempos dos cartões (espera, última mensagem), atualizado a cada 30 s
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(refresh);
  }, [router]);
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
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[1900px]:grid-cols-8">
          {shown.map((g) => (
            <GroupCard key={g.id} g={g} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
