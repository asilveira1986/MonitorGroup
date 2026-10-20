'use client';

import { AlertOctagon, Building2, CheckCircle2, Clock, Hourglass, Lock, MinusCircle, Search, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/ui';
import { cn, formatDuration, formatNumber } from '@/lib/format';

export type PanelStatus = 'late' | 'waiting' | 'answered' | 'neutral';

export type PanelGroup = {
  id: string;
  name: string;
  sector_id?: string | null;
  /** responsável pelo grupo (pessoa da equipe) */
  responsible_id?: string | null;
  responsible_name?: string | null;
  /** conversa encerrada pela mensagem de fechamento */
  closed_at?: string | null;
  /** jid do grupo quando há imagem do grupo guardada */
  photo_jid?: string | null;
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
    card: 'border-critical/60 border-t-4 border-t-critical bg-critical/[0.07] ring-1 ring-critical/30',
    badge: 'bg-critical text-white',
    dot: 'bg-critical',
  },
  waiting: {
    label: 'Aguardando resposta',
    filter: 'Aguardando',
    icon: Hourglass,
    card: 'border-warning/60 border-t-4 border-t-warning bg-warning/[0.07]',
    badge: 'bg-warning/20 text-warning-ink',
    dot: 'bg-warning',
  },
  answered: {
    label: 'Tudo respondido hoje',
    filter: 'Respondidos',
    icon: CheckCircle2,
    card: 'border-good/50 border-t-4 border-t-good bg-good/[0.06]',
    badge: 'bg-good/15 text-good-ink',
    dot: 'bg-good',
  },
  neutral: {
    label: 'Sem mensagens hoje',
    filter: 'Sem mensagens',
    icon: MinusCircle,
    card: 'border-line border-t-4 border-t-line bg-surface',
    badge: 'bg-surface-2 text-muted',
    dot: 'bg-muted/50',
  },
};
const ORDER: PanelStatus[] = ['late', 'waiting', 'answered', 'neutral'];
/** a partir de quantos dias sem mensagens o cartão destaca o silêncio (mesmo padrão do indicador Grupos silenciosos) */
const SILENT_DAYS = 3;

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
  // grupo sem interação hoje: o destaque é há quantos dias foi a última mensagem
  const quiet = g.status === 'neutral';
  const daysQuiet = g.last_message_at ? Math.floor(since(g.last_message_at) / 86400) : null;
  const longQuiet = daysQuiet != null && daysQuiet >= SILENT_DAYS;
  return (
    <Link
      href={`/groups/${g.id}?de=painel`}
      title={`${g.name} · ${s.label}`}
      className={cn(
        'flex min-h-[5.5rem] flex-col justify-between rounded-xl border p-3 shadow-sm transition hover:-translate-y-px hover:shadow-md',
        s.card,
      )}
    >
      <div>
        <div className="flex items-start gap-1.5">
          {g.photo_jid ? (
            <span className="relative shrink-0">
              <Avatar jid={g.photo_jid} hasPhoto name={g.name} className="h-6 w-6 rounded-full bg-surface-2 text-[9px]" />
              <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface', s.dot)} aria-hidden />
            </span>
          ) : (
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', s.dot)} aria-hidden />
          )}
          <h3 className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug text-ink">{g.name}</h3>
        </div>
        {g.closed_at && (g.status === 'answered' || g.status === 'neutral') && (
          <p className="mt-0.5 flex items-center gap-1 pl-3.5 text-[11px] font-medium text-good-ink" title="Encerrada pela mensagem de fechamento">
            <Lock className="h-3 w-3 shrink-0" aria-hidden /> conversa encerrada
          </p>
        )}
        {g.responsible_name && (
          <p className="mt-0.5 flex items-center gap-1 truncate pl-3.5 text-[11px] text-ink-2" title="Responsável pelo grupo">
            <UserCheck className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{g.responsible_name}</span>
          </p>
        )}
        {time && !quiet && (
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
        {quiet ? (
          <p
            className={cn('whitespace-nowrap text-xs', longQuiet ? 'text-warning-ink' : 'text-ink-2')}
            title={
              g.last_message_at
                ? `Última mensagem em ${new Date(g.last_message_at).toLocaleString('pt-BR')}`
                : 'O grupo ainda não teve mensagens'
            }
            suppressHydrationWarning
          >
            {daysQuiet == null ? (
              'sem mensagens ainda'
            ) : daysQuiet === 0 ? (
              <>
                última mensagem <span className="font-semibold tabular text-ink">há {formatDuration(since(g.last_message_at!))}</span>
              </>
            ) : (
              <>
                <span className={cn('text-base font-semibold tabular', longQuiet ? 'text-warning-ink' : 'text-ink')}>{daysQuiet}</span>{' '}
                {daysQuiet === 1 ? 'dia' : 'dias'} sem mensagens
              </>
            )}
          </p>
        ) : (
          <p className="whitespace-nowrap text-xs text-ink-2">
            <span className="text-base font-semibold tabular text-ink">{formatNumber(g.received_today)}</span>{' '}
            {g.received_today === 1 ? 'mensagem hoje' : 'mensagens hoje'}
          </p>
        )}
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
const RESPONSIBLE_KEY = 'panel-responsible';
const FILTERS_KEY = 'panel-filters';

const FIELD =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-brand-line focus:ring-2 focus:ring-brand/20';
/** campo com filtro aplicado: destacado para ver de relance o que está filtrando */
const ACTIVE_FIELD = 'border-brand-line bg-brand-soft/40 font-medium';
const CHIP = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition';
const COUNT = 'tabular min-w-[1.375rem] rounded-full px-1.5 py-px text-center text-[11px] font-semibold';

/** Campo do filtro com o nome em cima. */
function FilterField({
  label,
  icon: Icon,
  className,
  children,
}: {
  label: string;
  icon?: typeof Search;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />} {label}
      </span>
      {children}
    </label>
  );
}

export function GroupsPanel({
  groups: allGroups,
  sectors,
  hasNoSector,
  defaultSector,
  responsibles,
  hasNoResponsible,
}: {
  /** pessoas da equipe e quantos grupos (no painel) cada uma é responsável */
  responsibles: { id: string; name: string; groups: number }[];
  hasNoResponsible: boolean;
  groups: PanelGroup[];
  sectors: { id: string; name: string }[];
  hasNoSector: boolean;
  /** Setor que abre selecionado (o Geral); 'all' quando não existe. */
  defaultSector: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<PanelStatus | 'all'>('all');
  // setor: 'all' (todos), 'none' (sem setor) ou o id do setor
  const [sector, setSector] = useState(defaultSector);
  // responsável: 'all', 'none' (sem responsável) ou o id da pessoa da equipe
  const [responsible, setResponsibleState] = useState('all');
  // lembra a escolha neste navegador (ex.: cada atendente abre já nos seus grupos)
  useEffect(() => {
    const load = () => {
      try {
        const saved = localStorage.getItem(RESPONSIBLE_KEY);
        if (saved && (saved === 'none' || responsibles.some((r) => r.id === saved))) setResponsibleState(saved);
      } catch {
        /* sem armazenamento local */
      }
    };
    load();
  }, [responsibles]);
  const setResponsible = (value: string) => {
    setResponsibleState(value);
    try {
      localStorage.setItem(RESPONSIBLE_KEY, value);
    } catch {
      /* sem armazenamento local */
    }
  };
  const groups = useMemo(
    () =>
      allGroups.filter(
        (g) =>
          (sector === 'all' || (sector === 'none' ? !g.sector_id : g.sector_id === sector)) &&
          (responsible === 'all' || (responsible === 'none' ? !g.responsible_id : g.responsible_id === responsible)),
      ),
    [allGroups, sector, responsible],
  );
  const [query, setQuery] = useState('');

  // ao voltar de um grupo, o painel reabre com os mesmos filtros (situação, setor e busca)
  const restored = useRef(false);
  useEffect(() => {
    const load = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? 'null') as {
          filter?: PanelStatus | 'all';
          sector?: string;
          query?: string;
        } | null;
        if (saved) {
          if (saved.filter) setFilter(saved.filter);
          if (saved.sector && (saved.sector === 'all' || saved.sector === 'none' || sectors.some((s) => s.id === saved.sector))) {
            setSector(saved.sector);
          }
          if (typeof saved.query === 'string') setQuery(saved.query);
        }
      } catch {
        /* sem armazenamento da sessão */
      }
      restored.current = true;
    };
    load();
    // só ao abrir a tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ filter, sector, query }));
    } catch {
      /* sem armazenamento da sessão */
    }
  }, [filter, sector, query]);

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
  const activeFilters = [filter !== 'all', sector !== 'all', responsible !== 'all', Boolean(q)].filter(Boolean).length;
  const clearFilters = () => {
    setFilter('all');
    setSector('all');
    setResponsible('all');
    setQuery('');
  };
  const shown = groups.filter((g) => (filter === 'all' || g.status === filter) && (!q || g.name.toLowerCase().includes(q)));

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
        {/* busca, setor e responsável */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:gap-x-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <FilterField label="Buscar" className="col-span-2 lg:col-span-1">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome do grupo"
                aria-label="Buscar grupo"
                className={cn(FIELD, 'pl-9', q && ACTIVE_FIELD)}
              />
            </span>
          </FilterField>
          {(sectors.length > 0 || hasNoSector) && (
            <FilterField label="Setor" icon={Building2}>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                aria-label="Filtrar por setor"
                className={cn(FIELD, sector !== 'all' && ACTIVE_FIELD)}
              >
                <option value="all">Todos</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {hasNoSector && <option value="none">Sem setor</option>}
              </select>
            </FilterField>
          )}
          {(responsibles.length > 0 || hasNoResponsible) && (
            <FilterField label="Responsável" icon={UserCheck}>
              <select
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                aria-label="Filtrar por responsável"
                className={cn(FIELD, responsible !== 'all' && ACTIVE_FIELD)}
              >
                <option value="all">Todos</option>
                {responsibles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.groups})
                  </option>
                ))}
                <option value="none">Sem responsável ({allGroups.filter((g) => !g.responsible_id).length})</option>
              </select>
            </FilterField>
          )}
        </div>

        {/* situação: um botão por cor do cartão, com a quantidade */}
        <div className="flex flex-col gap-2 border-t border-line pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap" role="group" aria-label="Filtrar por situação">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={cn(CHIP, filter === 'all' ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink')}
            >
              Todos
              <span className={cn(COUNT, filter === 'all' ? 'bg-bg/20 text-bg' : 'bg-surface-2 text-ink')}>{groups.length}</span>
            </button>
            {ORDER.map((k) => {
              const Icon = STATUS[k].icon;
              const on = filter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(on ? 'all' : k)}
                  aria-pressed={on}
                  title={STATUS[k].label}
                  disabled={!counts[k] && !on}
                  className={cn(
                    CHIP,
                    'disabled:cursor-default disabled:opacity-45',
                    on ? cn(STATUS[k].card, 'text-ink') : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', on ? '' : 'opacity-70')} aria-hidden />
                  {STATUS[k].filter}
                  <span className={cn(COUNT, counts[k] ? STATUS[k].badge : 'bg-surface-2 text-muted')}>{counts[k]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-ink-2 lg:justify-end">
            <span>
              Mostrando <strong className="tabular text-ink">{shown.length}</strong> de{' '}
              <span className="tabular">{allGroups.length}</span> grupos
            </span>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-brand-text hover:bg-brand-soft"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Limpar filtros ({activeFilters})
              </button>
            )}
          </div>
        </div>
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
