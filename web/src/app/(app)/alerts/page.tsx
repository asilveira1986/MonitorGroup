import { BellOff, Check, CheckCheck, Eye, Mail, MessageCircle, Webhook } from 'lucide-react';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { Badge, Card, EmptyState, PageHeader, SeverityBadge } from '@/components/ui';
import { ALERT_TYPE_LABEL, cn, formatDateTime, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Alert } from '@/lib/types';
import { resolveAllAlerts, updateAlertStatus } from '../actions';

const TABS = [
  { value: 'open', label: 'Em aberto' },
  { value: 'acknowledged', label: 'Em análise' },
  { value: 'resolved', label: 'Resolvidos' },
  { value: 'all', label: 'Todos' },
];

const CHANNEL_ICON: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageCircle, webhook: Webhook };

export default async function AlertsPage({ searchParams }: PageProps<'/alerts'>) {
  const sp = await searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'open';

  const supabase = await createClient();
  let query = supabase
    .from('alerts')
    .select('*, groups(name), profiles:acknowledged_by(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status !== 'all') query = query.eq('status', status);
  const [{ data }, { data: settings }] = await Promise.all([
    query,
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
  ]);
  const alerts = (data ?? []) as (Alert & {
    groups: { name: string } | null;
    profiles: { full_name: string | null; email: string } | null;
  })[];

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Situações que precisam de atenção. Configure as regras em Configurações > Alertas."
        action={
          status === 'open' &&
          alerts.length > 0 && (
            <ActionButton action={resolveAllAlerts} confirm="Resolver todos os alertas em aberto?" success="Alertas resolvidos">
              <CheckCheck className="h-3.5 w-3.5" /> Resolver todos
            </ActionButton>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex sm:flex-nowrap sm:gap-0">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/alerts?status=${t.value}`}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium sm:py-1.5',
              status === t.value ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink',
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {alerts.length === 0 ? (
        <Card>
          <EmptyState icon={<BellOff />} title="Nenhum alerta por aqui" description="Quando uma regra for disparada, o alerta aparece nesta lista." />
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card
              key={a.id}
              className={cn(
                'flex flex-col gap-3 p-4 sm:flex-row sm:items-start',
                a.status === 'open' && a.severity === 'critical' && 'border-critical/40',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <Badge>{ALERT_TYPE_LABEL[a.type] ?? a.type}</Badge>
                  {a.status === 'acknowledged' && <Badge tone="info">Em análise</Badge>}
                  {a.status === 'resolved' && <Badge tone="good">Resolvido</Badge>}
                  <span className="text-xs text-muted" title={formatDateTime(a.created_at, settings?.timezone)}>
                    {timeAgo(a.created_at)}
                  </span>
                </div>
                <p className="mt-2 font-medium">{a.title}</p>
                {a.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{a.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {a.group_id && (
                    <Link href={`/groups/${a.group_id}`} className="text-brand hover:underline">
                      Abrir conversa{a.groups?.name ? ` · ${a.groups.name}` : ''}
                    </Link>
                  )}
                  {a.notified_channels
                    .filter((c) => c !== 'in_app')
                    .map((c) => {
                      const Icon = CHANNEL_ICON[c] ?? Mail;
                      return (
                        <span key={c} className="inline-flex items-center gap-1">
                          <Icon className="h-3.5 w-3.5" /> notificado por {c}
                        </span>
                      );
                    })}
                  {a.profiles && a.status !== 'open' && (
                    <span>por {a.profiles.full_name || a.profiles.email}</span>
                  )}
                </div>
              </div>
              {a.status !== 'resolved' && (
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                  {a.status === 'open' && (
                    <ActionButton action={updateAlertStatus.bind(null, a.id, 'acknowledged')} variant="ghost">
                      <Eye className="h-3.5 w-3.5" /> Estou vendo
                    </ActionButton>
                  )}
                  <ActionButton action={updateAlertStatus.bind(null, a.id, 'resolved')} success="Alerta resolvido">
                    <Check className="h-3.5 w-3.5" /> Resolver
                  </ActionButton>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
