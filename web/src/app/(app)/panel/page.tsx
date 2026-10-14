import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { GroupsPanel, type PanelGroup } from './panel';

export const metadata: Metadata = { title: 'Monitor Group · Painel de grupos' };

/**
 * Painel de grupos: um cartão por grupo com as últimas mensagens recebidas.
 * Neutro sem mensagem no dia, verde com tudo respondido, amarelo aguardando
 * resposta e vermelho quando o tempo de resposta (SLA) foi excedido.
 */
export default async function PanelPage() {
  await requireMenu('/panel');
  const supabase = await createClient();
  const [{ data, error }, { data: groupSectors }, { data: sectors }] = await Promise.all([
    supabase.rpc('groups_panel'),
    supabase.from('groups').select('id, sector_id'),
    supabase.from('sectors').select('id, name').order('name'),
  ]);
  const sectorOf = new Map((groupSectors ?? []).map((g) => [g.id as string, (g.sector_id as string | null) ?? null]));
  const groups = ((data ?? []) as PanelGroup[]).map((g) => ({
    ...g,
    sector_id: sectorOf.get(g.id) ?? null,
  }));
  // setores que têm grupo no painel (o usuário só recebe os grupos que pode ver)
  const used = new Set(groups.map((g) => g.sector_id));
  const sectorOptions = (sectors ?? []).filter((s) => used.has(s.id));
  const geral = sectorOptions.find((s) => s.name.trim().toLowerCase() === 'geral');

  return (
    <div data-wide>
      <PageHeader
        title="Painel de grupos"
        description="Cada grupo num cartão. Vermelho: passou do tempo de resposta. Amarelo: aguardando resposta. Verde: tudo respondido hoje. Neutro: sem mensagens hoje. Clique no cartão para abrir o grupo."
      />
      {error ? (
        <Card>
          <EmptyState icon={<AlertTriangle />} title="Não foi possível carregar o painel" description={error.message} />
        </Card>
      ) : (
        <GroupsPanel groups={groups} sectors={sectorOptions} hasNoSector={used.has(null)} defaultSector={geral?.id ?? 'all'} />
      )}
    </div>
  );
}
