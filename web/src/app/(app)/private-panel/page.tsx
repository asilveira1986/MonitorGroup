import { AlertTriangle, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PrivatePanel, type PanelChat } from './private-panel';

export const metadata: Metadata = { title: 'Monitor Group · Painel de privadas' };

/**
 * Painel de conversas privadas: um cartão por conversa em aberto, como o Painel de grupos. Vermelho: o cliente espera
 * além do tempo de resposta padrão. Amarelo: aguardando resposta. Verde: conversa de hoje respondida. Neutro: sem
 * mensagens hoje. Por enquanto só o administrador geral da plataforma abre.
 */
export default async function PrivatePanelPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: allowed }, { data, error }, { data: instRows }, { data: sectorRows }, { data: agents }] = await Promise.all([
    supabase.rpc('can_use_private_chats'),
    supabase.rpc('private_panel'),
    supabase.from('whatsapp_instances').select('*'),
    supabase.from('sectors').select('id, name').order('name'),
    supabase.rpc('private_chat_agents'),
  ]);
  const sectorOfInstance = new Map(((instRows ?? []) as { id: string; sector_id?: string | null }[]).map((i) => [i.id, i.sector_id ?? null]));
  const instanceName = new Map(((instRows ?? []) as { id: string; name?: string | null }[]).map((i) => [i.id, i.name ?? null]));
  const agentName = new Map(((agents ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const chats = ((data ?? []) as PanelChat[]).map((c) => ({
    ...c,
    sector_id: c.instance_id ? (sectorOfInstance.get(c.instance_id) ?? null) : null,
    instance_name: c.instance_id ? (instanceName.get(c.instance_id) ?? null) : null,
    assigned_name: c.assigned_to ? (agentName.get(c.assigned_to) ?? 'outro usuário') : null,
  }));
  const usedSectors = new Set(chats.map((c) => c.sector_id));
  const sectors = ((sectorRows ?? []) as { id: string; name: string }[]).filter((s) => usedSectors.has(s.id));
  const responsibles = [...new Map(chats.filter((c) => c.assigned_to).map((c) => [c.assigned_to!, c.assigned_name!])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <div data-wide>
      <PageHeader
        title="Painel de privadas"
        description="Cada conversa privada em aberto num cartão. Vermelho: o cliente espera além do tempo de resposta. Amarelo: aguardando resposta. Verde: respondida hoje. Neutro: sem mensagens hoje. Clique no cartão para abrir a conversa."
      />
      {!allowed ? (
        <Card>
          <EmptyState icon={<Lock />} title="Desligado nesta empresa" description="As conversas privadas não estão liberadas para esta empresa (Empresas › Conversas privadas)." />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle />}
            title="Não foi possível carregar o painel"
            description={/private_panel/.test(error.message) ? 'Falta aplicar o script do banco (item 0183).' : error.message}
          />
        </Card>
      ) : (
        <PrivatePanel chats={chats} sectors={sectors} hasNoSector={usedSectors.has(null)} responsibles={responsibles} />
      )}
    </div>
  );
}
