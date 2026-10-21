import { requireMenu } from '@/lib/auth';
import { BellOff, Check, CheckCheck, Eye, Mail, MessageCircle, Webhook } from 'lucide-react';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { Badge, Card, EmptyState, PageHeader, SeverityBadge } from '@/components/ui';
import { ALERT_TYPE_LABEL, cn, formatDateTime, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Alert, MyPermissions } from '@/lib/types';
import { resolveAllAlerts, updateAlertStatus } from '../actions';
import { AlertMutes, type AlertMuteItem, type AlertMuteRow } from './alert-mutes';
import { AlertFilters } from './filters';

const SEVERITIES = ['critical', 'warning', 'info'];

const CHANNEL_ICON: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageCircle, webhook: Webhook };

export default async function AlertsPage({ searchParams }: PageProps<'/alerts'>) {
  await requireMenu('/alerts');
  const sp = await searchParams;
  const type = typeof sp.type === 'string' && sp.type in ALERT_TYPE_LABEL ? sp.type : null;
  const severity = typeof sp.severity === 'string' && SEVERITIES.includes(sp.severity) ? sp.severity : null;

  const supabase = await createClient();
  // pendentes (em aberto e em análise) primeiro; depois os resolvidos mais recentes
  const base = () => {
    let q = supabase
      .from('alerts')
      .select('*, groups(name), profiles:acknowledged_by(full_name, email)')
      .order('created_at', { ascending: false });
    if (type) q = q.eq('type', type);
    if (severity) q = q.eq('severity', severity);
    return q;
  };
  const [{ data: active }, { data: resolved }, { data: settings }, { data: rules }, { data: indicators }, { data: blocks }, { data: perms }, { data: mutes }, { data: canMute }] =
    await Promise.all([
    base().neq('status', 'resolved').limit(200),
    base().eq('status', 'resolved').limit(100),
    supabase.from('app_settings').select('timezone').single(),
    supabase.from('alert_rules').select('type, indicator_key').eq('active', true),
    supabase.from('my_indicators').select('key, block_key, enabled, alert_enabled'),
    supabase.from('my_indicator_blocks').select('key, enabled'),
    supabase.rpc('my_permissions'),
    // silenciar alertas por tipo (0054)
    supabase.from('alert_type_mutes').select('type, muted_until, muted_by_name').gt('muted_until', new Date().toISOString()),
    supabase.rpc('can_mute_alerts'),
  ]);

  // tipos do filtro = os das regras ativas nas configurações (regra presa a um indicador desligado,
  // ou com o alerta dele desligado, não dispara — o mesmo critério do worker)
  const offBlocks = new Set((blocks ?? []).filter((b) => !b.enabled).map((b) => b.key as string));
  const alertable = new Set(
    ((indicators ?? []) as { key: string; block_key: string; enabled: boolean; alert_enabled: boolean }[])
      .filter((i) => i.enabled && i.alert_enabled && !offBlocks.has(i.block_key))
      .map((i) => i.key),
  );
  const enabledTypes = Object.keys(ALERT_TYPE_LABEL).filter((t) =>
    (rules ?? []).some((r) => r.type === t && (!r.indicator_key || alertable.has(r.indicator_key))),
  );
  // o que dá para silenciar: nova mensagem, SLA excedido e os tipos das regras ligadas
  const muteRows = (mutes ?? []) as AlertMuteRow[];
  const muteItems: AlertMuteItem[] = [
    { type: 'message', label: 'Nova mensagem de cliente', hint: 'Aviso em tela, voz e som quando um cliente escreve.' },
    { type: 'sla', label: 'SLA excedido', hint: 'Aviso em tela e voz quando a mensagem passa do tempo de resposta.' },
    ...Object.keys(ALERT_TYPE_LABEL)
      .filter((t) => enabledTypes.includes(t) || muteRows.some((m) => m.type === t))
      .map((t) => ({ type: t, label: ALERT_TYPE_LABEL[t], hint: 'Aviso em tela, voz e o aviso por WhatsApp/e-mail da regra.' })),
  ];
  const alerts = [...(active ?? []), ...(resolved ?? [])] as (Alert & {
    groups: { name: string } | null;
    profiles: { full_name: string | null; email: string } | null;
  })[];
  // tratar alertas: administrador, alerta sem grupo, ou setor do grupo com essa permissão
  const myPerms = perms as MyPermissions | null;
  const canHandle = (a: Alert) => Boolean(myPerms?.admin) || !a.group_id || Boolean(myPerms?.alert_groups.includes(a.group_id));
  const handleableOpen = alerts.filter((a) => a.status !== 'resolved' && canHandle(a)).length;

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Situações que precisam de atenção. Configure as regras em Configurações › Regras de alerta."
        action={
          handleableOpen > 0 && (
            <ActionButton action={resolveAllAlerts} confirm="Resolver todos os alertas em aberto?" success="Alertas resolvidos">
              <CheckCheck className="h-3.5 w-3.5" /> Resolver todos
            </ActionButton>
          )
        }
      />

      <AlertMutes items={muteItems} mutes={muteRows} canMute={Boolean(canMute)} />

      <AlertFilters types={type && !enabledTypes.includes(type) ? [...enabledTypes, type] : enabledTypes} />

      {alerts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BellOff />}
            title="Nenhum alerta por aqui"
            description={
              type || severity
                ? 'Nenhum alerta com esses filtros. Troque o tipo ou a gravidade.'
                : 'Quando uma regra for disparada, o alerta aparece nesta lista.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card
              key={a.id}
              className={cn(
                'flex flex-col gap-3 p-4 sm:flex-row sm:items-start',
                a.status === 'open' && a.severity === 'critical' && 'border-critical/40',
                a.status === 'resolved' && 'opacity-70',
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
                    <Link href={`/groups/${a.group_id}`} className="text-brand-text hover:underline">
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
              {a.status !== 'resolved' && canHandle(a) && (
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
