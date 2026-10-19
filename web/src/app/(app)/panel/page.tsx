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
  const [{ data, error }, { data: groupSectors }, { data: sectors }, { data: team }] = await Promise.all([
    supabase.rpc('groups_panel'),
    supabase.from('groups').select('id, sector_id, responsible_member_id, team_members(name)'),
    supabase.from('sectors').select('id, name').order('name'),
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
  ]);
  type GroupInfo = { id: string; sector_id: string | null; responsible_member_id: string | null; team_members: { name: string } | null };
  const infoOf = new Map(((groupSectors ?? []) as unknown as GroupInfo[]).map((g) => [g.id, g]));
  const groups = ((data ?? []) as PanelGroup[]).map((g) => ({
    ...g,
    sector_id: infoOf.get(g.id)?.sector_id ?? null,
    responsible_id: infoOf.get(g.id)?.responsible_member_id ?? null,
    responsible_name: infoOf.get(g.id)?.team_members?.name ?? null,
  }));
  // filtro por responsável: toda a equipe ativa + quem ainda é responsável por algum grupo
  const names = new Map((team ?? []).map((t) => [t.id as string, t.name as string]));
  for (const g of groups) if (g.responsible_id && !names.has(g.responsible_id)) names.set(g.responsible_id, g.responsible_name ?? 'Responsável');
  const responsibles = [...names]
    .map(([id, name]) => ({ id, name, groups: groups.filter((g) => g.responsible_id === id).length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
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
        <GroupsPanel
          groups={groups}
          sectors={sectorOptions}
          hasNoSector={used.has(null)}
          defaultSector={geral?.id ?? 'all'}
          responsibles={responsibles}
          hasNoResponsible={groups.some((g) => !g.responsible_id)}
        />
      )}
    </div>
  );
}
