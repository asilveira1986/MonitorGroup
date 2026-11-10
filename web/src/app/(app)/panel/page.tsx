import type { FollowupInfo } from '@/lib/followup-view';
import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { appSettings } from '@/lib/app-settings';
import { requireMenu } from '@/lib/auth';
import { defaultPanelSector } from '@/lib/panel-defaults';
import { withAdmins } from '@/lib/responsibles';
import { createClient } from '@/lib/supabase/server';
import { GroupsPanel, type PanelGroup } from './panel';

export const metadata: Metadata = { title: 'Monitor Group · Painel de grupos' };

/**
 * Painel de grupos: um cartão por grupo com as últimas mensagens recebidas.
 * Neutro sem mensagem no dia, verde com tudo respondido, amarelo aguardando
 * resposta e vermelho quando o tempo de resposta (SLA) foi excedido.
 */
export default async function PanelPage() {
  const profile = await requireMenu('/panel');
  const supabase = await createClient();
  const [{ data, error }, { data: groupSectors }, { data: sectors }, { data: team }, { data: myIds }, { data: settings }, { data: adminRows }] = await Promise.all([
    supabase.rpc('groups_panel'),
    supabase.from('groups').select('*'),
    supabase.from('sectors').select('id, name').order('name'),
    supabase.from('team_members').select('id, name, active').order('name'),
    // pessoas da equipe ligadas ao e-mail de acesso deste usuário (0059)
    supabase.rpc('my_team_member_ids'),
    appSettings(),
    // pessoas da equipe que são administradores (0162): valem como responsáveis de todos os grupos, se a empresa deixa
    supabase.rpc('admin_team_member_ids'),
  ]);
  const adminsOn = settings?.admins_responsible_all === true;
  const adminIds: string[] = adminsOn ? ((adminRows ?? []) as string[]) : [];
  type GroupInfo = {
    id: string;
    sector_id: string | null;
    responsible_member_id: string | null;
    responsible_member_ids?: string[] | null;
    closed_at?: string | null;
    jid?: string;
    monitored?: boolean;
    removed_at?: string | null;
  } & FollowupInfo;
  const infoOf = new Map(((groupSectors ?? []) as unknown as GroupInfo[]).map((g) => [g.id, g]));
  const { data: photoRows } = await supabase.from('contact_avatars').select('jid').like('jid', '%@g.us').not('path', 'is', null);
  const withPhoto = new Set((photoRows ?? []).map((r) => r.jid as string));
  const teamName = new Map((team ?? []).map((t) => [t.id as string, t.name as string]));
  const responsiblesOf = (i: GroupInfo | undefined) =>
    i?.responsible_member_ids?.length ? i.responsible_member_ids : i?.responsible_member_id ? [i.responsible_member_id] : [];
  const groups = ((data ?? []) as PanelGroup[]).map((g) => ({
    ...g,
    sector_id: infoOf.get(g.id)?.sector_id ?? null,
    jid: infoOf.get(g.id)?.jid ?? null,
    responsible_ids: responsiblesOf(infoOf.get(g.id)),
    closed_at: infoOf.get(g.id)?.closed_at ?? null,
    // pendência da conversa por regras (0167): com quem ficou a próxima ação
    followup_status: infoOf.get(g.id)?.followup_status ?? null,
    followup_reason: infoOf.get(g.id)?.followup_reason ?? null,
    followup_excerpt: infoOf.get(g.id)?.followup_excerpt ?? null,
    followup_actor: infoOf.get(g.id)?.followup_actor ?? null,
    followup_due_at: infoOf.get(g.id)?.followup_due_at ?? null,
    responsible_names: withAdmins(responsiblesOf(infoOf.get(g.id)).map((id) => teamName.get(id) ?? 'Responsável'), adminsOn),
    photo_jid: withPhoto.has(infoOf.get(g.id)?.jid ?? '') ? (infoOf.get(g.id)?.jid ?? null) : null,
  }));
  // filtro por responsável: toda a equipe ativa + quem ainda é responsável por algum grupo
  const inUse = new Set(groups.flatMap((g) => g.responsible_ids));
  const responsibles = (team ?? [])
    .filter((t) => t.active || inUse.has(t.id as string))
    .map((t) => ({
      id: t.id as string,
      name: t.name as string,
      // administrador responde por todos os grupos do painel (0162)
      groups: adminIds.includes(t.id as string) ? groups.length : groups.filter((g) => g.responsible_ids.includes(t.id as string)).length,
      // grupos da pessoa que não entram no painel (monitoramento desligado ou o número saiu do grupo)
      hidden: ((groupSectors ?? []) as unknown as GroupInfo[]).filter(
        (g) => (!g.monitored || g.removed_at) && responsiblesOf(g).includes(t.id as string),
      ).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  // setores que têm grupo no painel (o usuário só recebe os grupos que pode ver)
  const used = new Set(groups.map((g) => g.sector_id));
  const sectorOptions = (sectors ?? []).filter((s) => used.has(s.id));
  const geral = sectorOptions.find((s) => s.name.trim().toLowerCase() === 'geral');
  // o painel abre já nos grupos do próprio usuário (os que ele é responsável); sem grupos, abre como antes
  const mine = ((myIds ?? []) as string[]).find((id) => responsibles.some((r) => r.id === id && r.groups > 0)) ?? null;

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
          // com os grupos dele filtrados, o setor fica em Todos para não esconder grupo de outro setor
          defaultSector={defaultPanelSector({
            isAdmin: profile.role === 'admin' || Boolean(profile.platform_admin),
            hasOwnGroups: Boolean(mine),
            generalSectorId: geral?.id ?? null,
          })}
          myMemberId={mine}
          responsibles={responsibles}
          adminResponsibleIds={adminIds}
          hasNoResponsible={groups.some((g) => !g.responsible_ids.length)}
        />
      )}
    </div>
  );
}
