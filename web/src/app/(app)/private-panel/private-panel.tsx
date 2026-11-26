'use client';

import { Building2, Clock, MailOpen, MessageCircle, Phone, Search, UserCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/ui';
import { CONTACT_INITIALS, cn, formatDuration, formatPhone, initials } from '@/lib/format';
import { useRealtime } from '@/lib/use-realtime';
import { ACTIVE_FIELD, CHIP, COUNT, FIELD, FilterField, ORDER, STATUS, type PanelStatus } from '../panel/panel';

export type PanelChat = {
  id: string;
  name: string | null;
  phone: string | null;
  instance_id: string | null;
  assigned_to: string | null;
  unread_count: number;
  last_message_at: string | null;
  /** a mensagem mais recente do cliente: ordena do último que escreveu para o primeiro (0188) */
  last_client_message_at?: string | null;
  last_message_preview: string | null;
  waiting_since: string | null;
  waiting_count: number | null;
  received_today: number;
  sent_today: number;
  sla_seconds: number;
  status: PanelStatus;
  // preenchidos pela página
  sector_id?: string | null;
  instance_name?: string | null;
  assigned_name?: string | null;
  /** identificador (jid) com a foto de perfil guardada, se houver */
  photo?: string | null;
};

const SILENT_DAYS = 3;
const FILTERS_KEY = 'private-panel-filters';

function ChatCard({ c, now }: { c: PanelChat; now: number }) {
  const s = STATUS[c.status];
  const since = (iso: string) => Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const title = c.name || (c.phone ? formatPhone(c.phone) : 'Sem nome');
  const quiet = c.status === 'neutral';
  const daysQuiet = c.last_message_at ? Math.floor(since(c.last_message_at) / 86400) : null;
  const longQuiet = daysQuiet != null && daysQuiet >= SILENT_DAYS;
  let time: { label: string; value: string; title: string } | null = null;
  if (c.waiting_since && c.status === 'late') {
    time = {
      label: 'atraso',
      value: formatDuration(Math.max(0, since(c.waiting_since) - c.sla_seconds)),
      title: `Esperando há ${formatDuration(since(c.waiting_since))} · tempo de resposta ${formatDuration(c.sla_seconds)}`,
    };
  } else if (c.waiting_since) {
    time = { label: 'espera', value: formatDuration(since(c.waiting_since)), title: `Cliente esperando resposta · tempo de resposta ${formatDuration(c.sla_seconds)}` };
  } else if (c.last_message_at) {
    time = { label: 'há', value: formatDuration(since(c.last_message_at)), title: 'Tempo desde a última mensagem' };
  }
  return (
    <Link
      href={`/private?c=${c.id}`}
      prefetch={false}
      title={`${title} · ${s.label}`}
      className={cn('flex min-h-[5.5rem] flex-col justify-between rounded-xl border p-3 shadow-sm transition hover:-translate-y-px hover:shadow-md', s.card)}
    >
      <div>
        <div className="flex items-start gap-1.5">
          <Avatar jid={c.photo} hasPhoto={Boolean(c.photo)} name={title} fallback={initials(title, CONTACT_INITIALS)} className="h-9 w-9 rounded-full bg-brand-soft text-xs text-brand-text" />
          <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', s.dot)} title={s.label} aria-hidden />
          <h3 className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug text-ink">{title}</h3>
          {c.unread_count > 0 && (
            <span className="tabular ml-auto shrink-0 rounded-full bg-good px-1.5 text-[9px] font-semibold text-white" title="Não lidas">
              {c.unread_count}
            </span>
          )}
        </div>
        {c.name && c.phone && (
          <p className="mt-0.5 flex items-center gap-1 truncate pl-[2.625rem] text-[9px] text-muted">
            <Phone className="h-3 w-3 shrink-0" aria-hidden /> {formatPhone(c.phone)}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1 truncate pl-[2.625rem] text-[9px] text-ink-2" title={c.assigned_name ? `Responsável: ${c.assigned_name}` : 'Aguardando atendimento (sem responsável)'}>
          <UserCheck className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{c.assigned_name ?? 'sem responsável'}</span>
        </p>
        {c.last_message_preview && (
          <p className="mt-1 line-clamp-2 break-words text-[11px] leading-snug text-ink-2" title={c.last_message_preview}>
            {c.last_message_preview}
          </p>
        )}
        {time && !quiet && (
          <p
            className={cn(
              'mt-0.5 flex items-center gap-1 pl-[2.625rem] text-[9px] tabular',
              c.status === 'late' ? 'font-semibold text-critical-ink' : c.status === 'waiting' ? 'font-semibold text-warning-ink' : 'text-muted',
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
          <p className={cn('whitespace-nowrap text-xs', longQuiet ? 'text-warning-ink' : 'text-ink-2')} suppressHydrationWarning>
            {daysQuiet == null ? (
              'sem mensagens ainda'
            ) : daysQuiet === 0 ? (
              <>
                última mensagem <span className="font-semibold tabular text-ink">há {formatDuration(since(c.last_message_at!))}</span>
              </>
            ) : (
              <>
                <span className={cn('text-base font-semibold tabular', longQuiet ? 'text-warning-ink' : 'text-ink')}>{daysQuiet}</span> {daysQuiet === 1 ? 'dia' : 'dias'} sem mensagens
              </>
            )}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** Grade de cartões das conversas privadas, com busca, setor do número, responsável e situação. Atualiza sozinha. */
export function PrivatePanel({
  chats: allChats,
  sectors,
  hasNoSector,
  responsibles,
}: {
  chats: PanelChat[];
  sectors: { id: string; name: string }[];
  hasNoSector: boolean;
  responsibles: { id: string; name: string }[];
}) {
  const router = useRouter();
  // situação (atrasados, aguardando, respondidos) ou "não lidas" (conversas com mensagens que ninguém abriu)
  const [filter, setFilter] = useState<PanelStatus | 'unread' | 'all'>('all');
  const [sector, setSector] = useState('all');
  const [responsible, setResponsible] = useState('all');
  const [query, setQuery] = useState('');
  const restored = useRef(false);

  // volta com os mesmos filtros (nesta sessão do navegador)
  useEffect(() => {
    const load = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? 'null') as { filter?: PanelStatus | 'unread' | 'all'; sector?: string; responsible?: string; query?: string } | null;
        if (saved) {
          // ("sem mensagens" deixou de ser filtro: vira Todos)
          if (saved.filter && saved.filter !== 'neutral') setFilter(saved.filter);
          if (saved.sector) setSector(saved.sector);
          if (saved.responsible) setResponsible(saved.responsible);
          if (typeof saved.query === 'string') setQuery(saved.query);
        }
      } catch {
        /* sem armazenamento da sessão */
      }
      restored.current = true;
    };
    load();
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ filter, sector, responsible, query }));
    } catch {
      /* sem armazenamento da sessão */
    }
  }, [filter, sector, responsible, query]);

  // relógio dos tempos dos cartões e atualização: a cada minuto (só com a aba visível) e a cada mudança nas conversas
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 60_000);
    const back = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener('visibilitychange', back);
    };
  }, [router]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useRealtime('private-panel', (channel) =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'private_chats' }, () => {
      if (timer.current || document.visibilityState !== 'visible') return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 4000);
    }),
  );

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const base = useMemo(
    () =>
      allChats.filter(
        (c) =>
          (sector === 'all' || (sector === 'none' ? !c.sector_id : c.sector_id === sector)) &&
          (responsible === 'all' || (responsible === 'none' ? !c.assigned_to : c.assigned_to === responsible)) &&
          (!q || (c.name ?? '').toLowerCase().includes(q) || (digits.length >= 3 && (c.phone ?? '').includes(digits))),
      ),
    [allChats, sector, responsible, q, digits],
  );
  const counts = useMemo(() => Object.fromEntries(ORDER.map((k) => [k, base.filter((c) => c.status === k).length])) as Record<PanelStatus, number>, [base]);
  // do último cliente que escreveu para o primeiro (sem mensagem do cliente, no fim)
  const byClient = (a: PanelChat, b: PanelChat) =>
    (b.last_client_message_at ?? '').localeCompare(a.last_client_message_at ?? '') || (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '');
  const unreadCount = base.filter((c) => c.unread_count > 0).length;
  const shown = [...(filter === 'all' ? base : filter === 'unread' ? base.filter((c) => c.unread_count > 0) : base.filter((c) => c.status === filter))].sort(byClient);
  const activeFilters = [filter !== 'all', sector !== 'all', responsible !== 'all', Boolean(q)].filter(Boolean).length;
  const clear = () => {
    setFilter('all');
    setSector('all');
    setResponsible('all');
    setQuery('');
  };

  return (
    <>
      <div className="mb-4 space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
          <FilterField label="Buscar" icon={Search}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome ou telefone" aria-label="Buscar conversa" className={cn(FIELD, 'pl-9')} />
            </div>
          </FilterField>
          {(sectors.length > 0 || hasNoSector) && (
            <FilterField label="Setor" icon={Building2}>
              <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Filtrar por setor" className={cn(FIELD, sector !== 'all' && ACTIVE_FIELD)}>
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
          <FilterField label="Responsável" icon={UserCheck}>
            <select value={responsible} onChange={(e) => setResponsible(e.target.value)} aria-label="Filtrar por responsável" className={cn(FIELD, responsible !== 'all' && ACTIVE_FIELD)}>
              <option value="all">Todos</option>
              {responsibles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value="none">Sem responsável (aguardando atendimento)</option>
            </select>
          </FilterField>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap" role="group" aria-label="Filtrar por situação">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={cn(CHIP, filter === 'all' ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink')}
            >
              Todos
              <span className={cn(COUNT, filter === 'all' ? 'bg-bg/20 text-bg' : 'bg-surface-2 text-ink')}>{base.length}</span>
            </button>
            {ORDER.filter((k) => k !== 'neutral').map((k) => {
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
                  className={cn(CHIP, 'disabled:cursor-default disabled:opacity-45', on ? cn(STATUS[k].card, 'text-ink') : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink')}
                >
                  <Icon className={cn('h-3.5 w-3.5', on ? '' : 'opacity-70')} aria-hidden />
                  {STATUS[k].filter}
                  <span className={cn(COUNT, counts[k] ? STATUS[k].badge : 'bg-surface-2 text-muted')}>{counts[k]}</span>
                </button>
              );
            })}
            {/* não lidas: conversas com mensagens que ninguém abriu (no lugar de "sem mensagens") */}
            <button
              type="button"
              onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')}
              aria-pressed={filter === 'unread'}
              title="Conversas com mensagens não lidas"
              disabled={!unreadCount && filter !== 'unread'}
              className={cn(
                CHIP,
                'disabled:cursor-default disabled:opacity-45',
                filter === 'unread' ? 'border-brand-line bg-brand-soft/60 text-ink' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink',
              )}
            >
              <MailOpen className={cn('h-3.5 w-3.5', filter === 'unread' ? '' : 'opacity-70')} aria-hidden />
              Não lidas
              <span className={cn(COUNT, unreadCount ? 'bg-good text-white' : 'bg-surface-2 text-muted')}>{unreadCount}</span>
            </button>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-ink-2 lg:justify-end">
            <span>
              Mostrando <strong className="tabular text-ink">{shown.length}</strong> de <span className="tabular">{allChats.length}</span> conversas
            </span>
            {activeFilters > 0 && (
              <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-brand-text hover:bg-brand-soft">
                <X className="h-3.5 w-3.5" aria-hidden /> Limpar filtros ({activeFilters})
              </button>
            )}
          </div>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<MessageCircle />} title="Nenhuma conversa" description={allChats.length ? 'Nenhuma conversa com esses filtros.' : 'Não há conversas privadas em aberto.'} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((c) => (
            <ChatCard key={c.id} c={c} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
