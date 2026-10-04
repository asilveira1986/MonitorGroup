import { ClipboardList } from 'lucide-react';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { DEFAULT_DEMAND_TYPES } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Demand } from '@/lib/types';
import { DemandsBoard, type DemandRow } from './board';

const STATUS_FILTER: Record<string, string[]> = {
  open: ['aberta', 'em_andamento'],
  delivered: ['entregue'],
  canceled: ['cancelada'],
  all: ['aberta', 'em_andamento', 'entregue', 'cancelada'],
};
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export default async function DemandsPage({ searchParams }: PageProps<'/demands'>) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const status = typeof sp.status === 'string' && sp.status in STATUS_FILTER ? sp.status : 'open';
  const groupId = isUuid(sp.group) ? sp.group : null;
  const assigneeId = isUuid(sp.assignee) ? sp.assignee : null;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';

  const supabase = await createClient();
  let query = supabase
    .from('demands')
    .select('*, groups(name), team_members(name)')
    .in('status', STATUS_FILTER[status])
    .order(status === 'open' ? 'opened_at' : 'updated_at', { ascending: status === 'open' })
    .limit(500);
  if (groupId) query = query.eq('group_id', groupId);
  if (assigneeId) query = query.eq('assignee_id', assigneeId);
  if (q) query = query.ilike('description', `%${q}%`);

  const [{ data }, { data: groups }, { data: members }, { data: settings }, { data: typeInd }, { count: openCount }] =
    await Promise.all([
      query,
      supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
      supabase.from('team_members').select('id, name').eq('active', true).order('name'),
      supabase.from('app_settings').select('timezone, demand_manual_enabled').eq('id', 1).single(),
      supabase.from('indicators').select('params').eq('key', 'tipo_demanda').maybeSingle(),
      supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', STATUS_FILTER.open),
    ]);

  const categories = (typeInd?.params as { categories?: { name: string }[] } | undefined)?.categories;
  const types = categories?.length ? categories.map((c) => c.name).filter(Boolean) : DEFAULT_DEMAND_TYPES;
  const rows = (data ?? []) as (Demand & { groups: { name: string } | null; team_members: { name: string } | null })[];

  return (
    <>
      <PageHeader
        title="Demandas"
        description="Pedidos dos clientes e o que já foi entregue. Crie pela conversa, com #demanda no WhatsApp ou aqui."
      />
      <DemandsBoard
        rows={rows.map(
          (d): DemandRow => ({ ...d, group_name: d.groups?.name ?? '—', assignee_name: d.team_members?.name ?? null }),
        )}
        groups={groups ?? []}
        members={members ?? []}
        types={types}
        timeZone={settings?.timezone ?? 'America/Sao_Paulo'}
        manualEnabled={settings?.demand_manual_enabled ?? true}
        openCount={openCount ?? 0}
        filters={{ status, groupId, assigneeId, q }}
        isAdmin={profile.role === 'admin'}
      />
      {rows.length === 0 && (
        <Card className="mt-4">
          <EmptyState
            icon={<ClipboardList />}
            title="Nenhuma demanda por aqui"
            description='Na conversa de um grupo, use "Criar demanda" numa mensagem do cliente, ou peça para a equipe responder a mensagem com #demanda no WhatsApp.'
          />
        </Card>
      )}
    </>
  );
}
