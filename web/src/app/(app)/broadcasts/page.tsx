import { AlertTriangle, Megaphone, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { appSettings } from '@/lib/app-settings';
import { requirePlatformAdmin } from '@/lib/auth';
import { CAMPAIGN_STATUS_LABEL, emptyCounts, groupCounts, settingsFromRow, totalOf } from '@/lib/broadcast';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { Progress } from './progress';
import { RateSettings } from './rate-settings';

export const metadata: Metadata = { title: 'Monitor Group · Disparos' };

type CampaignRow = { id: string; name: string; target: 'groups' | 'people'; status: string; scheduled_at: string; created_at: string };

const TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'brand' | 'info'> = {
  scheduled: 'info',
  running: 'brand',
  paused: 'warning',
  done: 'good',
  cancelled: 'neutral',
};

/**
 * Disparos (0150): mensagens em massa para grupos e pessoas, filtradas por etiqueta, setor ou escolha manual,
 * enviadas agora ou agendadas, em ritmo controlado para proteger o número.
 */
export default async function BroadcastsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [campaigns, counts, settings] = await Promise.all([
    supabase.from('broadcast_campaigns').select('id, name, target, status, scheduled_at, created_at').order('created_at', { ascending: false }).limit(100),
    supabase.rpc('broadcast_counts'),
    appSettings(),
  ]);

  // sem o script do banco (0150) as tabelas não existem
  if (campaigns.error) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Falta atualizar o banco de dados"
          description="Rode no SQL Editor do Supabase o script supabase/atualizar_banco_parte2.sql (item 0150) e recarregue esta página."
        />
      </Card>
    );
  }

  const byCampaign = groupCounts((counts.data ?? []) as { campaign_id: string; status: string; n: number }[]);
  const rows = (campaigns.data ?? []) as CampaignRow[];

  return (
    <div data-wide className="space-y-6">
      <PageHeader
        title="Disparos"
        description="Envie uma mensagem para vários grupos ou pessoas de uma vez, por etiqueta, setor ou escolha manual, agora ou agendada."
        action={
          <Link href="/broadcasts/new" className="btn-signal inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium text-brand-ink sm:h-10">
            <Plus className="h-4 w-4" /> Novo disparo
          </Link>
        }
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="Nenhum disparo ainda" description="Crie o primeiro em “Novo disparo”. Você vê a lista de quem vai receber antes de enviar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line/80 text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">Disparo</th>
                  <th className="px-4 py-3 font-medium">Para</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">Andamento</th>
                  <th className="px-4 py-3 font-medium">Envio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const n = byCampaign.get(c.id) ?? emptyCounts();
                  return (
                    <tr key={c.id} className="border-b border-line/50 last:border-0 hover:bg-surface-2/60">
                      <td className="px-4 py-3">
                        <Link href={`/broadcasts/${c.id}`} className="font-medium text-ink hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{c.target === 'groups' ? 'Grupos' : 'Pessoas'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={TONE[c.status] ?? 'neutral'}>{CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}</Badge>
                      </td>
                      <td className="min-w-48 px-4 py-3">
                        <Progress counts={n} compact />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                        {formatDateTime(c.scheduled_at)}
                        {totalOf(n) === 0 && <span className="ml-1 text-xs text-muted">(sem destinatários)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RateSettings initial={settingsFromRow(settings.data as Record<string, unknown> | null)} />
    </div>
  );
}
