import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import { CAMPAIGN_STATUS_LABEL, describeRecurrence, emptyCounts, groupCounts, MEDIA_TYPE_LABEL, RECIPIENT_STATUS_LABEL, WEEKDAY_LABEL, type BroadcastReport, type MediaType, type Recurrence } from '@/lib/broadcast';
import { formatDateTime, formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { Progress } from '../progress';
import { Report } from '../report';
import { Controls, LiveRefresh, RetryFailures } from './controls';

export const metadata: Metadata = { title: 'Monitor Group · Disparo' };

type Recipient = { id: string; kind: 'group' | 'person'; name: string | null; phone: string | null; status: string; error: string | null; sent_at: string | null };

const RECIPIENT_TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'brand'> = {
  pending: 'neutral',
  sending: 'brand',
  sent: 'good',
  failed: 'critical',
  skipped: 'warning',
};

const SHOWN = 1000;

export default async function BroadcastDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const { status } = await searchParams;
  const supabase = await createClient();
  const { data: campaign } = await supabase.from('broadcast_campaigns').select('*').eq('id', id).maybeSingle();
  if (!campaign) notFound();

  let query = supabase
    .from('broadcast_recipients')
    .select('id, kind, name, phone, status, error, sent_at')
    .eq('campaign_id', id)
    .order('created_at')
    .order('id')
    .limit(SHOWN);
  if (status && status in RECIPIENT_STATUS_LABEL) query = query.eq('status', status);
  const isSeries = Boolean(campaign.recurrence);
  const [{ data: recipients }, { data: countRows }, report, children] = await Promise.all([
    query,
    supabase.rpc('broadcast_counts'),
    // sem o script 0152 a função não existe: sem relatório
    supabase.rpc('broadcast_report', { p_id: id }),
    isSeries
      ? supabase.from('broadcast_campaigns').select('id, name, status, scheduled_at').eq('series_id', id).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as { id: string; name: string; status: string; scheduled_at: string }[] }),
  ]);
  const childRows = (children.data ?? []) as { id: string; name: string; status: string; scheduled_at: string }[];
  const allCounts = groupCounts((countRows ?? []) as { campaign_id: string; status: string; n: number }[]);
  const counts = groupCounts(((countRows ?? []) as { campaign_id: string; status: string; n: number }[]).filter((r) => r.campaign_id === id)).get(id) ?? emptyCounts();
  const list = (recipients ?? []) as Recipient[];
  const active = ['scheduled', 'running', 'paused', 'series'].includes(campaign.status);

  return (
    <div data-wide className="space-y-6">
      <LiveRefresh />
      <PageHeader
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={campaign.status === 'done' ? 'good' : campaign.status === 'paused' ? 'warning' : campaign.status === 'cancelled' ? 'neutral' : 'brand'}>
              {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
            </Badge>
            <span>{campaign.target === 'groups' ? 'Grupos' : 'Pessoas'}</span>
            {isSeries ? <span>· {describeRecurrence(campaign.recurrence as Recurrence)}</span> : <span>· Envio: {formatDateTime(campaign.scheduled_at)}</span>}
            {campaign.finished_at && <span>· Fim: {formatDateTime(campaign.finished_at)}</span>}
          </span>
        }
        action={
          <>
            <Link href="/broadcasts" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2">
              <ArrowLeft className="h-4 w-4" /> Disparos
            </Link>
            {campaign.status !== 'cancelled' && counts.failed > 0 && <RetryFailures id={id} failed={counts.failed} />}
            {active && <Controls id={id} status={campaign.status} />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {isSeries ? (
          <Card>
            <CardHeader title="Envios desta série" description="Cada horário cria um envio com o público daquele momento." />
            <div className="space-y-3 p-4 sm:p-5">
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">Próximo envio</dt>
                  <dd className="font-medium text-ink">{campaign.status === 'series' ? formatDateTime(campaign.next_run_at) : '—'}</dd>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">Último horário</dt>
                  <dd className="font-medium text-ink">{formatDateTime(campaign.last_run_at)}</dd>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">O que aconteceu</dt>
                  <dd className="text-ink">{campaign.last_run_note ?? 'Ainda não enviou.'}</dd>
                </div>
              </dl>
              {childRows.length === 0 ? (
                <p className="text-sm text-muted">Nenhum envio ainda.</p>
              ) : (
                <ul className="divide-y divide-line/60 rounded-xl border border-line/80">
                  {childRows.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link href={`/broadcasts/${c.id}`} className="font-medium text-ink hover:underline">
                        {c.name}
                      </Link>
                      <span className="flex items-center gap-3">
                        <Progress counts={allCounts.get(c.id) ?? emptyCounts()} compact />
                        <Badge tone={c.status === 'done' ? 'good' : c.status === 'paused' ? 'warning' : c.status === 'cancelled' ? 'neutral' : 'brand'}>
                          {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : (
        <Card>
          <CardHeader
            title="Destinatários"
            action={
              <div className="flex flex-wrap gap-1.5 text-xs">
                {[['', 'Todos'], ...Object.entries(RECIPIENT_STATUS_LABEL)].map(([k, label]) => (
                  <Link
                    key={k || 'all'}
                    href={k ? `/broadcasts/${id}?status=${k}` : `/broadcasts/${id}`}
                    className={`rounded-full px-2.5 py-1 font-medium ${(status ?? '') === k ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            }
          />
          <div className="overflow-x-auto p-2 sm:p-3">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Destinatário</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted">
                      Nenhum destinatário nesta situação.
                    </td>
                  </tr>
                )}
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-line/50">
                    <td className="px-3 py-2">
                      {r.name || formatPhone(r.phone)}
                      {r.name && r.phone && <span className="ml-2 text-xs text-muted">{formatPhone(r.phone)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={RECIPIENT_TONE[r.status] ?? 'neutral'}>{RECIPIENT_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{r.status === 'sent' ? formatDateTime(r.sent_at) : (r.error ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length >= SHOWN && <p className="px-3 py-2 text-xs text-muted">Mostrando os primeiros {SHOWN}. Use os filtros de situação para ver os demais.</p>}
          </div>
        </Card>
        )}

        <div className="space-y-6">
          {!isSeries && (
          <Card>
            <CardHeader title="Andamento" />
            <div className="space-y-3 p-4 sm:p-5">
              <Progress counts={counts} />
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(RECIPIENT_STATUS_LABEL).map(([k, label]) => (
                  <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-lg font-semibold text-ink">{counts[k as keyof typeof counts]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
          )}
          {!report.error && report.data && <Report report={report.data as BroadcastReport} series={isSeries} />}
          <Card>
            <CardHeader title="Mensagem" />
            <div className="space-y-3 p-4 text-sm text-ink sm:p-5">
              {campaign.media_path && (
                <p className="text-xs text-ink-2">
                  Arquivo: {MEDIA_TYPE_LABEL[campaign.media_type as MediaType] ?? 'Arquivo'}
                  {campaign.media_name ? ` · ${campaign.media_name}` : ''}
                </p>
              )}
              {campaign.message && <p className="whitespace-pre-wrap">{campaign.message}</p>}
              {((campaign.variants ?? []) as string[]).map((v, i) => (
                <div key={i} className="rounded-xl bg-surface-2 p-3">
                  <p className="mb-1 text-xs font-medium text-muted">Variação {i + 1}</p>
                  <p className="whitespace-pre-wrap">{v}</p>
                </div>
              ))}
              {campaign.window_enabled && (
                <p className="text-xs text-ink-2">
                  Só envia {((campaign.window_days ?? []) as number[]).map((x) => WEEKDAY_LABEL[x]).join(', ')}, das {campaign.window_start} às {campaign.window_end}.
                </p>
              )}
              {campaign.optout_footer && <p className="text-xs text-ink-2">Com o aviso “responda SAIR” no fim.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
