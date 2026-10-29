import { Lock, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ContactsSync } from './contacts-sync';
import { PrivateInbox, type PrivateChat } from './inbox';
import type { ChatAgent } from './owner-control';
import type { CustomerTag } from '@/components/customer-tags';

export const metadata: Metadata = { title: 'Monitor Group · Conversas privadas' };

/**
 * Conversas privadas (1 a 1) do WhatsApp conectado: receber, responder e iniciar conversas com um
 * contato salvo ou um número novo. Administradores e atendentes: cada um vê as suas conversas e as sem
 * responsável; administradores veem todas (0114).
 */
export default async function PrivatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: allowed }, { data: chats }, { data: settings }, { data: instance }, { data: tagRows }] = await Promise.all([
    supabase.rpc('can_use_private_chats'),
    supabase.from('private_chats').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(300),
    supabase.from('app_settings').select('timezone').maybeSingle(),
    supabase.from('whatsapp_instances').select('status').eq('status', 'connected').limit(1).maybeSingle(),
    // etiquetas de clientes (0103)
    supabase.from('customer_tags').select('id, name, color').order('name'),
  ]);
  // responsável pelas conversas (0114): administradores veem todas; a lista de quem pode receber
  const [{ data: seesAll }, { data: agents }, { data: instRows }, { data: sectorRows }] = await Promise.all([
    supabase.rpc('private_sees_all'),
    supabase.rpc('private_chat_agents'),
    // setor de cada número (0121): filtro por setor
    supabase.from('whatsapp_instances').select('*'),
    supabase.from('sectors').select('id, name').order('name'),
  ]);
  const byInstance: Record<string, string | null> = Object.fromEntries(
    ((instRows ?? []) as { id: string; sector_id?: string | null }[]).map((i) => [i.id, i.sector_id ?? null]),
  );
  const usedSectors = new Set(Object.values(byInstance).filter(Boolean));
  const sectorFilter = usedSectors.size
    ? { options: ((sectorRows ?? []) as { id: string; name: string }[]).filter((s) => usedSectors.has(s.id)), byInstance }
    : undefined;
  // situação dos contatos (0072) e quantos estão guardados
  const [{ data: conns }, { count: contacts }, { count: named }] = await Promise.all([
    supabase.from('whatsapp_instances').select('contacts_sync_status, contacts_synced_at').eq('company_id', profile.company_id ?? ''),
    supabase.from('wa_contacts').select('jid', { count: 'exact', head: true }),
    supabase.from('wa_contacts').select('jid', { count: 'exact', head: true }).not('name', 'is', null),
  ]);
  // todas as conexões da empresa: sincronizando se alguma estiver; a sincronização mais recente
  const rows = (conns ?? []) as { contacts_sync_status: string | null; contacts_synced_at: string | null }[];
  const latest = [...rows].sort((x, y) => ((y.contacts_synced_at ?? '') > (x.contacts_synced_at ?? '') ? 1 : -1))[0];
  const sync = {
    contacts_sync_status: rows.some((r) => r.contacts_sync_status === 'syncing') ? 'syncing' : (latest?.contacts_sync_status ?? null),
    contacts_synced_at: latest?.contacts_synced_at ?? null,
  };
  const sp = await searchParams;

  return (
    <div data-wide>
      <PageHeader
        title="Conversas privadas"
        description="Mensagens no privado do WhatsApp conectado: responda, veja os contatos e inicie conversas. Não entram nos indicadores dos grupos."
      />
      {!allowed ? (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Desligado nesta empresa"
            description="As conversas privadas não estão liberadas para esta empresa. Quem administra a plataforma liga em Empresas › Conversas privadas."
          />
        </Card>
      ) : (
        <>
          {!instance && (
            <p className="mb-3 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-ink">
              <MessageCircle className="h-4 w-4" /> O WhatsApp desta empresa está desconectado: as mensagens novas chegam quando ele reconectar.
            </p>
          )}
          <ContactsSync
            status={sync.contacts_sync_status}
            syncedAt={sync.contacts_synced_at}
            count={contacts ?? 0} named={named ?? 0}
          />
          <PrivateInbox
            initialChats={(chats ?? []) as PrivateChat[]}
            selectedId={typeof sp.c === 'string' ? sp.c : null}
            timeZone={settings?.timezone ?? 'America/Sao_Paulo'}
            tags={(tagRows ?? []) as CustomerTag[]}
            viewer={{ me: profile.id, seesAll: Boolean(seesAll), agents: (agents ?? []) as ChatAgent[] }}
            sectors={sectorFilter}
          />
        </>
      )}
    </div>
  );
}
