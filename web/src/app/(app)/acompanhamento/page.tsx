import { Activity, AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import { cn, formatNumber, formatPhone, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { AutoRefresh } from './auto-refresh';

export const metadata: Metadata = { title: 'Monitor Group · Acompanhamento' };

type Person = { name: string; email: string; role: string; platform_admin: boolean; last_access: string | null; online: boolean };
type NumberRow = { name: string | null; phone: string | null; status: string | null; last_seen_at: string | null };
type Company = {
  id: string;
  name: string;
  active: boolean;
  users: number;
  online: number;
  today: number;
  week: number;
  idle_7d: number;
  never: number;
  last_access: string | null;
  numbers: number;
  numbers_connected: number;
  numbers_list: NumberRow[];
  groups: number;
  groups_waiting: number;
  messages_today: number;
  messages_7d: number;
  private_today: number;
  private_7d: number;
  private_waiting: number;
  alerts_open: number;
  demands_open: number;
  demands_overdue: number;
  last_activity: string | null;
  people: Person[];
};

const STATUS: Record<string, string> = { connected: 'conectado', disconnected: 'desconectado', qr: 'aguardando QR', connecting: 'conectando' };
const ROLE: Record<string, string> = { admin: 'Administrador', agent: 'Atendente', viewer: 'Visualizador', agenda: 'Agenda' };
const sum = (list: Company[], k: keyof Company) => list.reduce((n, c) => n + Number(c[k] ?? 0), 0);

/**
 * Acompanhamento da plataforma (0135): por empresa, quem está online, quem acessa e quem não acessa,
 * os números de WhatsApp e o movimento. Só quem administra a plataforma.
 */
export default async function MonitorPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  // quem está vendo a tela também está online
  await supabase.rpc('touch_last_seen');
  const { data, error } = await supabase.rpc('platform_monitor');
  const companies = (data ?? []) as Company[];
  const active = companies.filter((c) => c.active);

  const totals = [
    { label: 'Online agora', value: sum(active, 'online'), hint: `de ${formatNumber(sum(active, 'users'))} usuários`, tone: 'good' },
    { label: 'Acessaram hoje', value: sum(active, 'today'), hint: `${formatNumber(sum(active, 'week'))} nos últimos 7 dias` },
    { label: 'Sem acesso há 7+ dias', value: sum(active, 'idle_7d'), hint: 'último acesso há mais de uma semana', tone: 'warning' },
    { label: 'Nunca acessaram', value: sum(active, 'never'), hint: 'cadastrados e sem nenhum acesso', tone: 'warning' },
    { label: 'WhatsApp conectados', value: sum(active, 'numbers_connected'), hint: `de ${formatNumber(sum(active, 'numbers'))} números`, tone: sum(active, 'numbers_connected') < sum(active, 'numbers') ? 'critical' : 'good' },
    { label: 'Mensagens hoje', value: sum(active, 'messages_today') + sum(active, 'private_today'), hint: `${formatNumber(sum(active, 'private_today'))} no privado` },
  ];

  return (
    <div data-wide>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Acompanhamento"
        description="Uso da plataforma por empresa: quem está online (sistema aberto nos últimos 3 minutos), quem acessa e quem não acessa, números de WhatsApp e movimento. Atualiza a cada minuto."
      />
      {error ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle />}
            title="Não foi possível carregar"
            description={/platform_monitor/.test(error.message) ? 'Rode o atualizar_banco no Supabase (script 0135).' : error.message}
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {totals.map((t) => (
              <Card key={t.label} className="p-4">
                <p className="text-xs text-ink-2">{t.label}</p>
                <p
                  className={cn(
                    'mt-1 text-2xl font-semibold tabular',
                    t.tone === 'good' && 'text-good-ink',
                    t.tone === 'warning' && t.value > 0 && 'text-warning-ink',
                    t.tone === 'critical' && 'text-critical-ink',
                  )}
                >
                  {formatNumber(t.value)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">{t.hint}</p>
              </Card>
            ))}
          </div>

          {companies.length === 0 && (
            <Card>
              <EmptyState icon={<Activity />} title="Nenhuma empresa" description="Cadastre empresas em Empresas." />
            </Card>
          )}
          <div className="space-y-3">
            {companies.map((c) => (
              <Card key={c.id} className={cn('overflow-hidden', !c.active && 'opacity-70')}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
                    <div className="min-w-48 flex-1">
                      <p className="flex items-center gap-2 font-semibold">
                        {c.name}
                        {!c.active && <Badge tone="critical">suspensa</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        último acesso {c.last_access ? timeAgo(c.last_access) : 'nunca'} · última ação {c.last_activity ? timeAgo(c.last_activity) : '—'}
                      </p>
                    </div>
                    <Metric label="Online" value={c.online} of={c.users} tone={c.online > 0 ? 'good' : undefined} />
                    <Metric label="Hoje" value={c.today} of={c.users} />
                    <Metric label="Sem acesso 7d+" value={c.idle_7d} tone={c.idle_7d > 0 ? 'warning' : undefined} />
                    <Metric label="Nunca" value={c.never} tone={c.never > 0 ? 'warning' : undefined} />
                    <Metric
                      label="WhatsApp"
                      value={c.numbers_connected}
                      of={c.numbers}
                      tone={c.numbers > 0 && c.numbers_connected < c.numbers ? 'critical' : undefined}
                    />
                    <Metric label="Msgs hoje" value={c.messages_today + c.private_today} />
                    <Metric label="Grupos aguardando" value={c.groups_waiting} of={c.groups} tone={c.groups_waiting > 0 ? 'warning' : undefined} />
                  </summary>
                  <div className="grid gap-4 border-t border-line px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Usuários</p>
                      <ul className="divide-y divide-line rounded-xl border border-line">
                        {c.people.map((p) => (
                          <li key={p.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                            <span
                              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', p.online ? 'bg-good' : 'bg-line')}
                              title={p.online ? 'Online agora' : 'Offline'}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{p.name}</span> <span className="text-xs text-muted">{p.email}</span>
                            </span>
                            <span className="text-xs text-ink-2">{p.platform_admin ? 'Plataforma' : (ROLE[p.role] ?? p.role)}</span>
                            <span
                              className={cn(
                                'w-36 text-right text-xs',
                                p.online
                                  ? 'font-medium text-good-ink'
                                  : !p.last_access || Date.parse(p.last_access) < Date.now() - 7 * 86_400_000
                                    ? 'text-warning-ink'
                                    : 'text-muted',
                              )}
                              suppressHydrationWarning
                            >
                              {p.online ? 'online agora' : p.last_access ? `acessou ${timeAgo(p.last_access)}` : 'nunca acessou'}
                            </span>
                          </li>
                        ))}
                        {c.people.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum usuário ativo.</li>}
                      </ul>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">WhatsApp</p>
                        <ul className="space-y-1 text-sm">
                          {c.numbers_list.map((n, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className={cn('h-2 w-2 rounded-full', n.status === 'connected' ? 'bg-good' : 'bg-critical')} />
                              <span className="min-w-0 flex-1 truncate">
                                {n.name ?? 'Número'} <span className="text-xs text-muted">{formatPhone(n.phone)}</span>
                              </span>
                              <span className="text-xs text-muted">{n.status ? (STATUS[n.status] ?? n.status) : '—'}</span>
                            </li>
                          ))}
                          {c.numbers_list.length === 0 && <li className="text-muted">Nenhum número.</li>}
                        </ul>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {[
                          ['Grupos monitorados', c.groups],
                          ['Msgs de grupo (7 dias)', c.messages_7d],
                          ['Msgs no privado (7 dias)', c.private_7d],
                          ['Privado aguardando', c.private_waiting],
                          ['Alertas abertos', c.alerts_open],
                          ['Demandas abertas', c.demands_open],
                          ['Demandas atrasadas', c.demands_overdue],
                          ['Acessaram (7 dias)', c.week],
                        ].map(([label, value]) => (
                          <div key={label as string}>
                            <dt className="text-xs text-muted">{label}</dt>
                            <dd className="font-semibold tabular">{formatNumber(value as number)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                </details>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, of, tone }: { label: string; value: number; of?: number; tone?: 'good' | 'warning' | 'critical' }) {
  return (
    <div className="min-w-16 text-center">
      <p
        className={cn(
          'text-lg font-semibold tabular leading-tight',
          tone === 'good' && 'text-good-ink',
          tone === 'warning' && 'text-warning-ink',
          tone === 'critical' && 'text-critical-ink',
        )}
      >
        {formatNumber(value)}
        {of != null && <span className="text-xs font-normal text-muted">/{formatNumber(of)}</span>}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
