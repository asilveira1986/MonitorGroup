'use client';

import {
  AlertOctagon,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  MessagesSquare,
  Smartphone,
  TimerOff,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui';
import { cn, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { InfoTip } from './info-tip';

type Tone = 'good' | 'warning' | 'critical' | null;
type Kpi = {
  value: number | null;
  tone?: Tone;
  hint?: string | null;
  secondary?: { label: string; value: number | null }[] | null;
} | null;

/** Totalizadores devolvidos por management_summary() (migração 0029). */
export type ManagementSummaryData = {
  client_messages: number;
  team_replies: number;
  first_response: Kpi;
  sla_rate: Kpi;
  sla_target?: number | null;
  groups_waiting: number;
  groups_late: number;
  pending_messages: number;
  alerts_open: number;
  alerts_critical: number;
  whatsapp: 'connected' | 'disconnected' | 'none';
  demands_open: number;
  demands_overdue: number;
  demands_created: number;
  demands_delivered: number;
  promise_kept: Kpi;
  resolution_time: Kpi;
  conversations: Kpi;
  conversations_closed_rate: number | null;
  groups_active: number;
  groups_monitored: number;
  groups_silent: Kpi;
  flow?: { x: string; label: string; received: number; answered: number; pending: number }[];
  flow_hourly?: boolean;
};

type Format = 'number' | 'percent' | 'duration';

const fmt = (v: number | null | undefined, f: Format = 'number') =>
  f === 'percent' ? formatPercent(v ?? null) : f === 'duration' ? formatDuration(v ?? null) : v == null ? '—' : formatNumber(v);

const TONE: Record<NonNullable<Tone>, { text: string; tile: string; icon: string; label: string; Icon: LucideIcon }> = {
  good: { text: 'text-good-ink', tile: 'bg-good/[0.07] border-good/25', icon: 'bg-good/15 text-good-ink', label: 'Dentro do esperado', Icon: CheckCircle2 },
  warning: {
    text: 'text-warning-ink',
    tile: 'bg-warning/[0.09] border-warning/35',
    icon: 'bg-warning/20 text-warning-ink',
    label: 'Atenção',
    Icon: Hourglass,
  },
  critical: {
    text: 'text-critical-ink',
    tile: 'bg-critical/[0.07] border-critical/30',
    icon: 'bg-critical/15 text-critical-ink',
    label: 'Crítico',
    Icon: AlertOctagon,
  },
};

/** Variação vs comparação, num selo verde (melhorou) ou vermelho (piorou). */
function Delta({
  value,
  previous,
  better,
  format = 'number',
  label,
}: {
  value: number | null | undefined;
  previous: number | null | undefined;
  better: 'up' | 'down';
  format?: Format;
  label: string;
}) {
  if (value == null || previous == null) return null;
  const diff = value - previous;
  if (Math.abs(diff) < (format === 'percent' ? 0.05 : 1)) {
    return <span className="text-[11px] text-muted">= {label}</span>;
  }
  const good = (diff > 0) === (better === 'up');
  const amount =
    format === 'percent'
      ? `${formatNumber(Math.abs(Math.round(diff * 10) / 10))} p.p.`
      : format === 'duration'
        ? formatDuration(Math.abs(diff))
        : formatNumber(Math.abs(diff));
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
        good ? 'bg-good/12 text-good-ink' : 'bg-critical/10 text-critical-ink',
      )}
      title={`Em ${label}: ${fmt(previous, format)}`}
    >
      {diff > 0 ? '▲' : '▼'} {amount}
      <span className="font-normal opacity-75">vs {label}</span>
    </span>
  );
}

/** Anel de progresso (0–100%) com marca de meta opcional. */
function Ring({
  value,
  target,
  size = 132,
  stroke = 12,
  color,
  children,
  label,
}: {
  value: number | null;
  target?: number | null;
  size?: number;
  stroke?: number;
  color: string;
  children: React.ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const angle = target != null ? (target / 100) * 2 * Math.PI - Math.PI / 2 : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${fmt(value, 'percent')}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {value != null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        )}
      </svg>
      {angle != null && (
        // marca da meta, por cima do anel
        <span
          className="absolute h-[18px] w-[3px] rounded-full bg-ink"
          style={{
            left: size / 2 + r * Math.cos(angle) - 1.5,
            top: size / 2 + r * Math.sin(angle) - 9,
            transform: `rotate(${(angle * 180) / Math.PI + 90}deg)`,
          }}
          title={`Meta: ${fmt(target, 'percent')}`}
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Barra horizontal empilhada com legenda (identidade nunca só pela cor). */
function StackBar({ parts, total }: { parts: { label: string; value: number; color: string }[]; total?: number }) {
  const sum = total ?? parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {sum > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span
                key={p.label}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(p.value / sum) * 100}%`, background: p.color }}
                title={`${p.label}: ${formatNumber(p.value)}`}
              />
            ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
            {p.label} <b className="tabular font-semibold text-ink">{formatNumber(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}
          <span className="tabular ml-auto pl-4 font-medium text-ink">{formatNumber(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

/** Fluxo do período: mensagens recebidas (área) x respostas da equipe. */
function FlowChart({ data, hourly }: { data: NonNullable<ManagementSummaryData['flow']>; hourly: boolean }) {
  const rows = data.map((d) => ({ ...d, label: hourly ? d.label : d.x.slice(8, 10) + '/' + d.x.slice(5, 7) }));
  if (!rows.some((r) => r.received || r.answered)) {
    return <p className="flex h-full min-h-28 items-center justify-center text-xs text-muted">Sem mensagens no período</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={rows} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="mgFlowIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="mgFlowOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="label"
          stroke="var(--axis)"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted)' }}
          minTickGap={14}
        />
        <YAxis stroke="var(--axis)" fontSize={10} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)' }} allowDecimals={false} />
        <Tooltip content={<FlowTooltip />} cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey="received"
          name="Recebidas"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#mgFlowIn)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
        <Area
          type="monotone"
          dataKey="answered"
          name="Respostas da equipe"
          stroke="var(--series-2)"
          strokeWidth={2}
          fill="url(#mgFlowOut)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SectionTitle({ icon: Icon, title, context, help }: { icon: LucideIcon; title: string; context: string; help: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#8fc41a] text-brand-ink shadow-[0_6px_14px_-6px_rgba(150,200,20,0.9)]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <h3 className="min-w-0 flex-1 text-sm font-semibold">
        {title} <span className="font-normal text-muted">· {context}</span>
      </h3>
      <InfoTip label={title} className="shrink-0">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-1 block">{help}</span>
      </InfoTip>
    </div>
  );
}

/** Cartão colorido da situação agora: ícone, número grande e link para a tela. */
function NowTile({
  icon: Icon,
  label,
  value,
  note,
  tone,
  href,
  help,
  pulse,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  tone: NonNullable<Tone>;
  href: string;
  help: string;
  pulse?: boolean;
}) {
  const t = TONE[tone];
  return (
    <Link
      href={href}
      title={help}
      className={cn(
        'group relative flex min-w-0 items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition hover:-translate-y-px hover:shadow-md sm:p-4',
        t.tile,
      )}
    >
      <span className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', t.icon)}>
        <Icon className="h-5 w-5" aria-hidden />
        {pulse && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-current opacity-60" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink-2">{label}</span>
        <span className={cn('block truncate font-semibold leading-tight tracking-tight', /^\d/.test(value) ? 'tabular text-2xl' : 'py-0.5 text-xl', t.text)}>
          {value}
        </span>
        <span className="line-clamp-2 block text-[11px] leading-snug text-muted">{note}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
      <span className="sr-only">{t.label}</span>
    </Link>
  );
}

/**
 * Visão da gestão: os totalizadores do topo do dashboard, de forma visual.
 *  1. Atendimento: anel do SLA (com a meta), números do período e o fluxo recebidas x respostas;
 *  2. Situação agora: cartões coloridos pelo estado (verde, amarelo, vermelho) com ícone e texto;
 *  3. Demandas e Conversas: barras empilhadas, anéis e a comparação com o período anterior.
 */
export function ManagementSummary({
  data: d,
  previous: p,
  periodLabel,
  comparisonLabel,
}: {
  data: ManagementSummaryData;
  previous: ManagementSummaryData | null;
  periodLabel: string;
  comparisonLabel: string;
}) {
  const slaTone: NonNullable<Tone> = d.sla_rate?.tone ?? (d.sla_rate?.value == null ? 'good' : 'good');
  const slaColor = d.sla_rate?.value == null ? 'var(--axis)' : slaTone === 'critical' ? 'var(--critical)' : slaTone === 'warning' ? 'var(--warning)' : 'var(--good)';
  const sec = (k: Kpi, label: string) => Number(k?.secondary?.find((s) => s.label === label)?.value ?? 0);
  const closedColor =
    d.conversations_closed_rate == null ? 'var(--axis)' : d.conversations?.tone === 'critical' ? 'var(--critical)' : d.conversations?.tone === 'warning' ? 'var(--warning)' : 'var(--good)';
  const onTime = Math.max(0, d.demands_open - d.demands_overdue);
  const maxFlow = Math.max(1, d.demands_created, d.demands_delivered);
  const activeShare = d.groups_monitored ? (d.groups_active / d.groups_monitored) * 100 : 0;
  const silent = Number(d.groups_silent?.value ?? 0);

  return (
    <section aria-labelledby="gestao" className="mb-8 space-y-4">
      <h2 id="gestao" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="h-2 w-2 rounded-full bg-brand shadow-[0_0_0_3px_rgba(198,244,50,0.25)]" aria-hidden />
        Visão da gestão
      </h2>

      {/* 1. atendimento */}
      <Card className="accent-top overflow-hidden p-4 sm:p-5">
        <SectionTitle
          icon={MessagesSquare}
          title="Atendimento"
          context={periodLabel}
          help="Volume e qualidade do atendimento no período do filtro. O anel mostra o percentual de respostas dentro do tempo de resposta (SLA) e o traço marca a meta."
        />
        <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="flex items-center gap-4">
            <Ring value={d.sla_rate?.value ?? null} target={d.sla_target ?? null} color={slaColor} label="Respondidas dentro do SLA">
              <span className={cn('text-2xl font-semibold tabular tracking-tight', d.sla_rate?.value != null && TONE[slaTone].text)}>
                {fmt(d.sla_rate?.value, 'percent')}
              </span>
              <span className="text-[11px] leading-tight text-muted">dentro do SLA</span>
            </Ring>
            <div className="min-w-0 space-y-1.5 lg:hidden xl:block xl:w-44">
              {d.sla_rate?.value != null && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[slaTone].icon)}>
                  {(() => {
                    const I = TONE[slaTone].Icon;
                    return <I className="h-3.5 w-3.5" aria-hidden />;
                  })()}
                  {TONE[slaTone].label}
                </span>
              )}
              <p className="text-[11px] leading-snug text-muted">{d.sla_rate?.hint ?? 'Sem respostas no período'}</p>
              <Delta value={d.sla_rate?.value} previous={p?.sla_rate?.value} better="up" format="percent" label={comparisonLabel} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="grid grid-cols-3 gap-3 border-b border-line pb-4">
              {[
                { label: 'Recebidas', dot: 'var(--series-1)', value: d.client_messages, prev: p?.client_messages, better: 'up' as const, f: 'number' as Format },
                { label: 'Respostas da equipe', dot: 'var(--series-2)', value: d.team_replies, prev: p?.team_replies, better: 'up' as const, f: 'number' as Format },
                { label: '1ª resposta média', dot: null, value: d.first_response?.value ?? null, prev: p?.first_response?.value, better: 'down' as const, f: 'duration' as Format },
              ].map((m) => (
                <div key={m.label} className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs text-ink-2">
                    {m.dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.dot }} aria-hidden />}
                    <span className="truncate">{m.label}</span>
                  </p>
                  <p className="mt-0.5 text-2xl font-semibold tabular tracking-tight sm:text-3xl">{fmt(m.value, m.f)}</p>
                  <div className="mt-0.5">
                    <Delta value={m.value} previous={m.prev} better={m.better} format={m.f} label={comparisonLabel} />
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3">
              <p className="mb-1 flex items-center justify-between text-xs text-ink-2">
                <span className="font-medium">Fluxo de mensagens {d.flow_hourly ? 'por hora' : 'por dia'}</span>
                <span className="flex items-center gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-series-1" /> Recebidas
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-series-2" /> Respostas
                  </span>
                </span>
              </p>
              <FlowChart data={d.flow ?? []} hourly={!!d.flow_hourly} />
            </div>
          </div>
        </div>
      </Card>

      {/* 2. situação agora */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          Situação agora
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NowTile
            icon={Hourglass}
            label="Aguardando resposta"
            value={formatNumber(d.groups_waiting)}
            note={`${d.groups_waiting === 1 ? 'grupo' : 'grupos'} · ${formatNumber(d.pending_messages)} mensagem(ns) pendente(s)`}
            tone={d.groups_waiting ? 'warning' : 'good'}
            href="/pending"
            help="Grupos com mensagem de cliente ainda sem resposta da equipe."
          />
          <NowTile
            icon={TimerOff}
            label="SLA estourado"
            value={formatNumber(d.groups_late)}
            note={d.groups_late ? 'grupos passaram do tempo de resposta' : 'nenhum grupo atrasado'}
            tone={d.groups_late ? 'critical' : 'good'}
            href="/panel"
            help="Grupos em que a espera do cliente já passou do tempo de resposta (SLA)."
            pulse={d.groups_late > 0}
          />
          <NowTile
            icon={BellRing}
            label="Alertas abertos"
            value={formatNumber(d.alerts_open)}
            note={d.alerts_critical ? `${formatNumber(d.alerts_critical)} crítico(s)` : 'nenhum crítico'}
            tone={d.alerts_critical ? 'critical' : d.alerts_open ? 'warning' : 'good'}
            href="/alerts"
            help="Alertas ainda não resolvidos (abertos ou reconhecidos)."
          />
          <NowTile
            icon={Smartphone}
            label="WhatsApp"
            value={d.whatsapp === 'connected' ? 'Conectado' : d.whatsapp === 'none' ? 'Sem número' : 'Desconectado'}
            note={d.whatsapp === 'connected' ? 'capturando mensagens' : 'mensagens não estão chegando'}
            tone={d.whatsapp === 'connected' ? 'good' : 'critical'}
            href="/settings/whatsapp"
            help="Conexão do número que captura as mensagens. Desconectado: nada novo chega ao sistema."
            pulse={d.whatsapp !== 'connected'}
          />
        </div>
      </div>

      {/* 3. demandas e conversas */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="accent-top overflow-hidden p-4 sm:p-5">
          <SectionTitle
            icon={ClipboardList}
            title="Demandas"
            context={periodLabel}
            help="Pedidos dos clientes registrados como demanda: o estoque em aberto agora (e quantas passaram do prazo) e o que entrou e foi entregue no período."
          />
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-4">
              <Link href="/demands" className="block rounded-xl transition hover:opacity-90">
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular tracking-tight">{formatNumber(d.demands_open)}</span>
                  <span className="text-sm text-ink-2">em aberto agora</span>
                </p>
                <div className="mt-2">
                  <StackBar
                    parts={[
                      { label: 'Com prazo vencido', value: d.demands_overdue, color: 'var(--critical)' },
                      { label: 'No prazo ou sem prazo', value: onTime, color: 'var(--series-1)' },
                    ]}
                  />
                </div>
              </Link>
              <div className="space-y-2">
                {[
                  { label: 'Novas', value: d.demands_created, prev: p?.demands_created, color: 'var(--series-4)', better: 'down' as const, href: '/demands?status=all' },
                  { label: 'Entregues', value: d.demands_delivered, prev: p?.demands_delivered, color: 'var(--series-3)', better: 'up' as const, href: '/demands?status=delivered' },
                ].map((r) => (
                  <Link key={r.label} href={r.href} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg hover:bg-surface-2/60">
                    <span className="text-xs text-ink-2">{r.label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${(r.value / maxFlow) * 100}%`, background: r.color }} />
                    </span>
                    <span className="flex items-center gap-2">
                      <b className="tabular text-sm font-semibold">{formatNumber(r.value)}</b>
                      <Delta value={r.value} previous={r.prev} better={r.better} label={comparisonLabel} />
                    </span>
                  </Link>
                ))}
                {d.resolution_time?.value != null && (
                  <p className="text-[11px] text-muted">Tempo médio do pedido até a entrega: {formatDuration(d.resolution_time.value)}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Ring
                value={d.promise_kept?.value ?? null}
                size={112}
                stroke={10}
                color={d.promise_kept?.tone === 'critical' ? 'var(--critical)' : d.promise_kept?.tone === 'warning' ? 'var(--warning)' : 'var(--good)'}
                label="Prazos cumpridos"
              >
                <span className="text-xl font-semibold tabular">{fmt(d.promise_kept?.value, 'percent')}</span>
              </Ring>
              <span className="text-[11px] text-muted">prazos cumpridos</span>
            </div>
          </div>
        </Card>

        <Card className="accent-top overflow-hidden p-4 sm:p-5">
          <SectionTitle
            icon={Users}
            title="Conversas e grupos"
            context={periodLabel}
            help="Como as conversas terminam (encerramento ou compromisso de retorno) e quantos grupos tiveram movimento no período."
          />
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div className="flex flex-col items-center gap-1">
              <Ring value={d.conversations_closed_rate} size={112} stroke={10} color={closedColor} label="Conversas fechadas">
                <span className="text-xl font-semibold tabular">{fmt(d.conversations_closed_rate, 'percent')}</span>
              </Ring>
              <span className="text-[11px] text-muted">conversas fechadas</span>
              <Delta value={d.conversations_closed_rate} previous={p?.conversations_closed_rate} better="up" format="percent" label={comparisonLabel} />
            </div>
            <div className="min-w-0 space-y-4">
              <div>
                <p className="mb-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular tracking-tight">{fmt(d.conversations?.value)}</span>
                  <span className="text-sm text-ink-2">conversas iniciadas</span>
                  <Delta value={d.conversations?.value} previous={p?.conversations?.value} better="up" label={comparisonLabel} />
                </p>
                <StackBar
                  total={Number(d.conversations?.value ?? 0)}
                  parts={[
                    { label: 'Encerradas', value: sec(d.conversations, 'Encerradas'), color: 'var(--series-3)' },
                    { label: 'Compromisso', value: sec(d.conversations, 'Compromisso de retorno'), color: 'var(--series-1)' },
                    { label: 'Retorno pendente', value: sec(d.conversations, 'Retorno pendente'), color: 'var(--series-4)' },
                    { label: 'Em aberto', value: sec(d.conversations, 'Em aberto'), color: 'var(--axis)' },
                    { label: 'Sem fechamento', value: sec(d.conversations, 'Sem fechamento'), color: 'var(--series-2)' },
                  ]}
                />
              </div>
              <Link href="/panel" className="block rounded-lg hover:bg-surface-2/60">
                <p className="mb-1 flex items-center justify-between text-xs text-ink-2">
                  <span>Grupos ativos no período</span>
                  <span>
                    <b className="tabular text-sm font-semibold text-ink">{formatNumber(d.groups_active)}</b> de {formatNumber(d.groups_monitored)}
                  </span>
                </p>
                <span className="block h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${activeShare}%` }} />
                </span>
                <p className={cn('mt-1.5 text-[11px]', silent ? 'text-warning-ink' : 'text-muted')}>
                  {silent ? `${formatNumber(silent)} grupo(s) silencioso(s) há dias` : 'Nenhum grupo silencioso'}
                </p>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
