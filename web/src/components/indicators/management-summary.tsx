import { ClipboardList, MessagesSquare, Radio, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { cn, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { InfoTip } from './info-tip';

type Kpi = { value: number | null; tone?: 'good' | 'warning' | 'critical' | null; hint?: string | null } | null;

/** Totalizadores devolvidos por management_summary() (migração 0029). */
export type ManagementSummaryData = {
  client_messages: number;
  team_replies: number;
  first_response: Kpi;
  sla_rate: Kpi;
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
};

type Format = 'number' | 'percent' | 'duration';
type Tone = 'good' | 'warning' | 'critical' | null;

type Stat = {
  label: string;
  value: number | null;
  /** texto no lugar do número (ex.: "Conectado") */
  text?: string;
  format?: Format;
  /** texto pequeno abaixo do número */
  note?: string;
  tone?: Tone;
  /** valor no período de comparação; 'up'/'down' = qual direção é melhor */
  previous?: number | null;
  better?: 'up' | 'down';
  href?: string;
  /** explicação no "i" */
  help: string;
};

const fmt = (v: number | null, f: Format = 'number') =>
  f === 'percent' ? formatPercent(v) : f === 'duration' ? formatDuration(v) : v == null ? '—' : formatNumber(v);

const TONE_TEXT: Record<NonNullable<Tone>, string> = {
  good: 'text-good-ink',
  warning: 'text-warning-ink',
  critical: 'text-critical-ink',
};

/** "▲ 12 vs ontem" colorido pelo que é melhor (mais respostas é bom; mais pendências é ruim). */
function Change({ stat, label }: { stat: Stat; label: string }) {
  if (stat.previous == null || stat.value == null || !stat.better) return null;
  const diff = stat.value - stat.previous;
  // igual: não mostra (fica só o número)
  if (Math.abs(diff) < (stat.format === 'percent' ? 0.05 : 1)) return null;
  const good = (diff > 0) === (stat.better === 'up');
  const amount =
    stat.format === 'percent'
      ? `${formatNumber(Math.abs(Math.round(diff * 10) / 10))} p.p.`
      : stat.format === 'duration'
        ? formatDuration(Math.abs(diff))
        : formatNumber(Math.abs(diff));
  return (
    <p className={cn('text-[11px]', good ? 'text-good-ink' : 'text-critical-ink')} title={`Em ${label}: ${fmt(stat.previous, stat.format)}`}>
      {diff > 0 ? '▲' : '▼'} {amount} <span className="text-muted">vs {label}</span>
    </p>
  );
}

function StatCell({ stat, comparisonLabel }: { stat: Stat; comparisonLabel: string }) {
  const body = (
    <>
      <p className="text-xs leading-snug text-ink-2">{stat.label}</p>
      <p
        className={cn(
          'mt-0.5 font-semibold tabular tracking-tight',
          stat.text ? 'py-1 text-base' : 'text-2xl',
          stat.tone ? TONE_TEXT[stat.tone] : 'text-ink',
        )}
      >
        {stat.text ?? fmt(stat.value, stat.format)}
      </p>
      {stat.note && <p className="line-clamp-2 text-[11px] leading-snug text-muted">{stat.note}</p>}
      <Change stat={stat} label={comparisonLabel} />
    </>
  );
  return (
    <div className="relative min-w-0 rounded-xl p-2.5 transition hover:bg-surface-2/60">
      {stat.href ? (
        <Link href={stat.href} className="block focus-visible:outline-2 focus-visible:outline-brand" title={stat.help}>
          {body}
        </Link>
      ) : (
        <div title={stat.help}>{body}</div>
      )}
    </div>
  );
}

function Group({
  icon: Icon,
  title,
  context,
  help,
  stats,
  comparisonLabel,
}: {
  icon: LucideIcon;
  title: string;
  context: string;
  help: string;
  stats: Stat[];
  comparisonLabel: string;
}) {
  return (
    <Card className="flex flex-col p-3 sm:p-4">
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          {title} <span className="font-normal text-muted">· {context}</span>
        </h3>
        <InfoTip label={title} className="shrink-0">
          <span className="block font-semibold text-ink">{title}</span>
          <span className="mt-1 block">{help}</span>
          <span className="mt-2 block text-muted">Passe o mouse num número para ver como ele é calculado; clique para abrir a tela correspondente.</span>
        </InfoTip>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {stats.map((s) => (
          <StatCell key={s.label} stat={s} comparisonLabel={comparisonLabel} />
        ))}
      </div>
    </Card>
  );
}

/**
 * Visão da gestão: totalizadores diretos no topo do dashboard, em quatro grupos
 * (atendimento, situação agora, demandas, conversas e grupos), com a comparação
 * com o período anterior colorida pelo que é melhor.
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
  const answeredShare = d.client_messages ? Math.min(100, (d.team_replies / d.client_messages) * 100) : null;
  const slaTone: Tone = d.sla_rate?.tone ?? null;
  const groups = [
    {
      icon: MessagesSquare,
      title: 'Atendimento',
      context: periodLabel,
      help: 'Volume e qualidade do atendimento no período escolhido no filtro.',
      stats: [
        {
          label: 'Mensagens recebidas',
          value: d.client_messages,
          previous: p?.client_messages,
          better: 'up',
          help: 'Mensagens enviadas pelos clientes nos grupos monitorados, no período.',
        },
        {
          label: 'Respostas da equipe',
          value: d.team_replies,
          note: answeredShare != null ? `${formatPercent(Math.round(answeredShare))} do volume de clientes` : undefined,
          previous: p?.team_replies,
          better: 'up',
          help: 'Mensagens da equipe nos grupos no período (com o filtro de atendente, só as dele).',
        },
        {
          label: '1ª resposta (média)',
          value: d.first_response?.value ?? null,
          format: 'duration',
          note: d.first_response?.hint ?? undefined,
          previous: p?.first_response?.value,
          better: 'down',
          help: 'Tempo médio até a equipe responder a mensagem do cliente (mesma regra do indicador Tempo de primeira resposta).',
        },
        {
          label: 'Dentro do SLA',
          value: d.sla_rate?.value ?? null,
          format: 'percent',
          tone: slaTone,
          note: d.sla_rate?.hint ?? undefined,
          previous: p?.sla_rate?.value,
          better: 'up',
          help: 'Percentual das respostas dadas dentro do tempo de resposta (SLA) do grupo.',
        },
      ],
    },
    {
      icon: Radio,
      title: 'Situação agora',
      context: 'tempo real',
      help: 'O que precisa de atenção neste momento, independente do período do filtro.',
      stats: [
        {
          label: 'Aguardando resposta',
          value: d.groups_waiting,
          note: `${formatNumber(d.pending_messages)} mensagem(ns) pendente(s)`,
          tone: d.groups_waiting ? 'warning' : 'good',
          href: '/pending',
          help: 'Grupos com mensagem de cliente ainda sem resposta da equipe.',
        },
        {
          label: 'SLA estourado',
          value: d.groups_late,
          note: d.groups_late ? 'grupos passaram do tempo de resposta' : 'nenhum grupo atrasado',
          tone: d.groups_late ? 'critical' : 'good',
          href: '/panel',
          help: 'Grupos em que a espera do cliente já passou do tempo de resposta (SLA).',
        },
        {
          label: 'Alertas abertos',
          value: d.alerts_open,
          note: d.alerts_critical ? `${formatNumber(d.alerts_critical)} crítico(s)` : 'nenhum crítico',
          tone: d.alerts_critical ? 'critical' : d.alerts_open ? 'warning' : 'good',
          href: '/alerts',
          help: 'Alertas ainda não resolvidos (abertos ou reconhecidos).',
        },
        {
          label: 'WhatsApp',
          value: null,
          text: d.whatsapp === 'connected' ? 'Conectado' : d.whatsapp === 'none' ? 'Sem número' : 'Desconectado',
          note: d.whatsapp === 'connected' ? 'capturando mensagens' : 'mensagens não estão chegando',
          tone: d.whatsapp === 'connected' ? 'good' : 'critical',
          href: '/settings/whatsapp',
          help: 'Conexão do número que captura as mensagens. Desconectado: nada novo chega ao sistema.',
        },
      ],
    },
    {
      icon: ClipboardList,
      title: 'Demandas',
      context: periodLabel,
      help: 'Pedidos dos clientes registrados como demanda: estoque em aberto agora e o que entrou e saiu no período.',
      stats: [
        {
          label: 'Em aberto agora',
          value: d.demands_open,
          note: d.demands_overdue ? `${formatNumber(d.demands_overdue)} com prazo vencido` : 'nenhuma vencida',
          tone: d.demands_overdue ? 'critical' : null,
          href: '/demands',
          help: 'Demandas abertas ou em andamento neste momento; vencidas = prazo passou sem entrega.',
        },
        {
          label: 'Novas',
          value: d.demands_created,
          previous: p?.demands_created,
          better: 'down',
          href: '/demands?status=all',
          help: 'Demandas registradas no período.',
        },
        {
          label: 'Entregues',
          value: d.demands_delivered,
          note: d.resolution_time?.value != null ? `em média ${formatDuration(d.resolution_time.value)}` : undefined,
          previous: p?.demands_delivered,
          better: 'up',
          href: '/demands?status=delivered',
          help: 'Demandas entregues no período e o tempo médio do pedido até a entrega.',
        },
        {
          label: 'Prazos cumpridos',
          value: d.promise_kept?.value ?? null,
          format: 'percent',
          tone: d.promise_kept?.tone ?? null,
          note: 'dos prazos informados pela equipe',
          previous: p?.promise_kept?.value,
          better: 'up',
          help: 'Percentual dos prazos informados pela equipe que foram cumpridos.',
        },
      ],
    },
    {
      icon: Users,
      title: 'Conversas e grupos',
      context: periodLabel,
      help: 'Como as conversas estão sendo conduzidas e quantos grupos tiveram movimento.',
      stats: [
        {
          label: 'Conversas iniciadas',
          value: d.conversations?.value ?? null,
          previous: p?.conversations?.value,
          better: 'up',
          help: 'Conversas começadas no período (mesma regra do indicador Início e fechamento das conversas).',
        },
        {
          label: 'Conversas fechadas',
          value: d.conversations_closed_rate,
          format: 'percent',
          tone: d.conversations?.tone ?? null,
          note: 'encerradas ou com compromisso',
          previous: p?.conversations_closed_rate,
          better: 'up',
          help: 'Percentual das conversas fechadas por mensagem de encerramento ou compromisso de retorno.',
        },
        {
          label: 'Grupos ativos',
          value: d.groups_active,
          note: `de ${formatNumber(d.groups_monitored)} monitorados`,
          previous: p?.groups_active,
          better: 'up',
          href: '/panel',
          help: 'Grupos monitorados com pelo menos uma mensagem no período.',
        },
        {
          label: 'Grupos silenciosos',
          value: d.groups_silent?.value ?? null,
          tone: d.groups_silent?.value ? 'warning' : 'good',
          note: 'sem mensagens há dias · agora',
          href: '/groups',
          help: 'Grupos sem nenhuma mensagem há alguns dias (configurável no indicador Grupos silenciosos).',
        },
      ],
    },
  ] satisfies { icon: LucideIcon; title: string; context: string; help: string; stats: Stat[] }[];

  return (
    <section aria-labelledby="gestao" className="mb-8">
      <h2 id="gestao" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        Visão da gestão
      </h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => (
          <Group
            key={g.title}
            icon={g.icon}
            title={g.title}
            context={g.context}
            help={g.help}
            comparisonLabel={comparisonLabel}
            stats={g.stats}
          />
        ))}
      </div>
    </section>
  );
}
