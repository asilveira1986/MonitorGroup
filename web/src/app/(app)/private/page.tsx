import { Lock, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ContactsSync } from './contacts-sync';
import { PrivateInbox, type PrivateChat } from './inbox';
import type { CustomerTag } from '@/components/customer-tags';

export const metadata: Metadata = { title: 'Monitor Group · Conversas privadas' };

/**
 * Conversas privadas (1 a 1) do WhatsApp conectado: receber, responder e iniciar conversas com um
 * contato salvo ou um número novo. Nesta fase, só para quem administra a plataforma (0069).
 */
export default async function PrivatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireProfile();
  if (!profile.platform_admin) redirect('/dashboard');
  const supabase = await createClient();
  const [{ data: allowed }, { data: chats }, { data: settings }, { data: instance }, { data: tagRows }] = await Promise.all([
    supabase.rpc('can_use_private_chats'),
    supabase.from('private_chats').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(300),
    supabase.from('app_settings').select('timezone').maybeSingle(),
    supabase.from('whatsapp_instances').select('status').eq('status', 'connected').limit(1).maybeSingle(),
    // etiquetas de clientes (0103)
    supabase.from('customer_tags').select('id, name, color').order('name'),
  ]);
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
          />
        </>
      )}
    </div>
  );
}
