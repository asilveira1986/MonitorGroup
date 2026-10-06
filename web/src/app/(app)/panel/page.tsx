import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { GroupsPanel, type PanelGroup } from './panel';

export const metadata: Metadata = { title: 'MonitorGroup · Painel de grupos' };

/**
 * Painel de grupos: um cartão por grupo com as últimas mensagens recebidas.
 * Neutro sem mensagem no dia, verde com tudo respondido, amarelo aguardando
 * resposta e vermelho quando o tempo de resposta (SLA) foi excedido.
 */
export default async function PanelPage() {
  await requireProfile();
  const supabase = await createClient();
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.rpc('groups_panel'),
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
  ]);

  return (
    <div data-wide>
      <PageHeader
        title="Painel de grupos"
        description="Cada grupo num cartão, com as últimas mensagens dos clientes. Vermelho: passou do tempo de resposta. Amarelo: aguardando resposta. Verde: tudo respondido hoje. Neutro: sem mensagens hoje."
      />
      {error ? (
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Não foi possível carregar o painel" description={error.message} />
        </Card>
      ) : (
        <GroupsPanel groups={(data ?? []) as PanelGroup[]} timeZone={settings?.timezone ?? 'America/Sao_Paulo'} />
      )}
    </div>
  );
}
