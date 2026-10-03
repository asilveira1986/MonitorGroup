import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, Clock, Gauge, Hourglass, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BucketsChart, HourlyChart, Legend, ResponseTimeChart, VolumeChart } from '@/components/charts';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { cn, formatDuration, formatNumber, formatPercent, secondsSince, startOfDayInTz, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { DashboardData } from '@/lib/types';
import { DashboardFilters } from './filters';

const DAYS: Record<string, number> = { today: 0, '7d': 6, '30d': 29, '90d': 89 };

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
}) {
  const toneClass = {
    neutral: 'bg-surface-2 text-ink-2',
    good: 'bg-good/12 text-good-ink',
    warning: 'bg-warning/15 text-warning-ink',
    critical: 'bg-critical/12 text-critical-ink',
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-ink-2">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', toneClass)}>{icon}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const sp = await searchParams;
  const period = typeof sp.period === 'string' && sp.period in DAYS ? sp.period : '7d';
  const groupId = typeof sp.group === 'string' && sp.group ? sp.group : null;

  const supabase = await createClient();
  const [{ data: settings }, { data: groups }] = await Promise.all([
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
  ]);
  const tz = settings?.timezone ?? 'America/Sao_Paulo';
  const from = startOfDayInTz(tz, DAYS[period]);
  const to = new Date();

  const { data, error } = await supabase.rpc('dashboard_metrics', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_group_id: groupId,
  });

  if (error || !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Não foi possível carregar as métricas" description={error?.message} />
        </Card>
      </>
    );
  }

  const m = data as DashboardData;
  const k = m.kpis;
  const slaRate = k.responses ? (k.responses_in_sla / k.responses) * 100 : null;
  const slaTone = slaRate == null ? 'neutral' : slaRate >= 90 ? 'good' : slaRate >= 70 ? 'warning' : 'critical';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Acompanhe o atendimento nos grupos de WhatsApp em tempo real."
        action={<DashboardFilters groups={groups ?? []} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Aguardando resposta agora"
          value={formatNumber(k.pending_groups)}
          icon={<Hourglass className="h-4 w-4" />}
          tone={k.overdue_groups > 0 ? 'critical' : k.pending_groups > 0 ? 'warning' : 'good'}
          hint={
            k.pending_groups > 0 ? (
              <>
                {k.overdue_groups} fora do SLA · mais antiga {timeAgo(k.oldest_pending)} ·{' '}
                <Link href="/pending" className="text-brand hover:underline">
                  ver fila
                </Link>
              </>
            ) : (
              'Todos os clientes foram respondidos 🎉'
            )
          }
        />
        <Kpi
          label="Tempo médio de 1ª resposta"
          value={formatDuration(k.avg_response_seconds)}
          icon={<Clock className="h-4 w-4" />}
          hint={`Mediana ${formatDuration(k.median_response_seconds)} · 90% em até ${formatDuration(k.p90_response_seconds)}`}
        />
        <Kpi
          label="Respondidas dentro do SLA"
          value={formatPercent(slaRate)}
          icon={<Gauge className="h-4 w-4" />}
          tone={slaTone}
          hint={`${formatNumber(k.responses_in_sla)} de ${formatNumber(k.responses)} respostas · SLA padrão ${m.default_sla_minutes} min`}
        />
        <Kpi
          label="Mensagens de clientes"
          value={formatNumber(k.received)}
          icon={<ArrowDownLeft className="h-4 w-4" />}
          hint={`${formatNumber(k.unique_clients)} clientes em ${formatNumber(k.active_groups)} grupos ativos`}
        />
        <Kpi
          label="Mensagens da equipe"
          value={formatNumber(k.sent)}
          icon={<ArrowUpRight className="h-4 w-4" />}
          hint={`${formatNumber(k.monitored_groups)} grupos monitorados`}
        />
        <Kpi
          label="Alertas em aberto"
          value={formatNumber(k.open_alerts)}
          icon={<Bell className="h-4 w-4" />}
          tone={k.open_alerts > 0 ? 'critical' : 'good'}
          hint={
            <Link href="/alerts" className="text-brand hover:underline">
              Ver alertas
            </Link>
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Volume de mensagens"
            description="Por dia, clientes x equipe"
            action={
              <Legend
                items={[
                  { label: 'Recebidas', color: 'var(--series-1)' },
                  { label: 'Enviadas', color: 'var(--series-2)' },
                ]}
              />
            }
          />
          <div className="px-2 pb-4 pt-2">
            <VolumeChart data={m.daily} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Tempo médio de 1ª resposta" description="Por dia, comparado ao SLA padrão" />
          <div className="px-2 pb-4 pt-2">
            <ResponseTimeChart data={m.daily} slaMinutes={m.default_sla_minutes} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Distribuição do tempo de resposta" description="Quantas respostas caíram em cada faixa" />
          <div className="px-2 pb-4 pt-2">
            <BucketsChart data={m.buckets} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Movimento por hora do dia"
            description={`Horário de ${m.timezone}`}
            action={
              <Legend
                items={[
                  { label: 'Recebidas', color: 'var(--series-1)' },
                  { label: 'Enviadas', color: 'var(--series-2)' },
                ]}
              />
            }
          />
          <div className="px-2 pb-4 pt-2">
            <HourlyChart data={m.hourly} />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Grupos com mais movimento" description="No período selecionado" />
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Grupo</th>
                  <th className="px-3 py-2 text-right font-medium">Recebidas</th>
                  <th className="px-3 py-2 text-right font-medium">Enviadas</th>
                  <th className="px-3 py-2 text-right font-medium">Tempo médio</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {m.top_groups.map((g) => (
                  <tr key={g.id} className="border-t border-line">
                    <td className="max-w-[220px] truncate px-3 py-2.5">
                      <Link href={`/groups/${g.id}`} className="font-medium hover:text-brand">
                        {g.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatNumber(g.received)}</td>
                    <td className="px-3 py-2.5 text-right">{formatNumber(g.sent)}</td>
                    <td className="px-3 py-2.5 text-right">{formatDuration(g.avg_response_seconds)}</td>
                    <td className="px-3 py-2.5">
                      {g.pending_since ? (
                        <Badge tone="warning" className="whitespace-nowrap">
                          <Hourglass className="h-3 w-3" /> aguardando {formatDuration(secondsSince(g.pending_since))}
                        </Badge>
                      ) : (
                        <Badge tone="good">Em dia</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.top_groups.length === 0 && (
              <EmptyState
                icon={<Users />}
                title="Nenhum grupo monitorado ainda"
                description="Conecte o WhatsApp em Configurações para começar."
              />
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Desempenho da equipe" description="Respostas a clientes e tempo médio" />
          <div className="space-y-1 p-3">
            {m.team.length === 0 && (
              <EmptyState icon={<Users />} title="Sem respostas no período" />
            )}
            {m.team.map((t, i) => {
              const max = Math.max(...m.team.map((x) => x.responses), 1);
              return (
                <div key={t.name} className="rounded-xl px-2 py-2 hover:bg-surface-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="tabular w-5 text-xs text-muted">{i + 1}º</span>
                      <span className="truncate font-medium">{t.name}</span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-ink-2">
                      {formatNumber(t.responses)} resp. · {formatDuration(t.avg_response_seconds)}
                    </span>
                  </div>
                  <div className="ml-7 mt-1.5 h-1.5 rounded-full bg-surface-2">
                    <div
                      className="h-1.5 rounded-full bg-series-1"
                      style={{ width: `${(t.responses / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
