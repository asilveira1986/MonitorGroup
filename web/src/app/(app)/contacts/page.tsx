import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import type { CustomerTag } from '@/components/customer-tags';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ContactsSync } from '../private/contacts-sync';
import { ContactsBook } from './contacts-book';

export const metadata: Metadata = { title: 'Monitor Group · Contatos' };

/**
 * Contatos (0112): a agenda do WhatsApp conectado, os contatos cadastrados no sistema, as conversas
 * privadas e a equipe numa lista só, com novo, editar, conversar e excluir. Mesmo acesso das
 * conversas privadas.
 */
export default async function ContactsPage() {
  const profile = await requireProfile();
  if (!profile.platform_admin) redirect('/dashboard');
  const supabase = await createClient();
  const [{ data: allowed }, { data: tagRows }, { data: conns }, { count: contacts }, { count: named }] = await Promise.all([
    supabase.rpc('can_use_private_chats'),
    supabase.from('customer_tags').select('id, name, color').order('name'),
    supabase.from('whatsapp_instances').select('contacts_sync_status, contacts_synced_at').eq('company_id', profile.company_id ?? ''),
    supabase.from('wa_contacts').select('jid', { count: 'exact', head: true }),
    supabase.from('wa_contacts').select('jid', { count: 'exact', head: true }).not('name', 'is', null),
  ]);
  const rows = (conns ?? []) as { contacts_sync_status: string | null; contacts_synced_at: string | null }[];
  const latest = [...rows].sort((x, y) => ((y.contacts_synced_at ?? '') > (x.contacts_synced_at ?? '') ? 1 : -1))[0];

  return (
    <div data-wide>
      <PageHeader
        title="Contatos"
        description="Todos os contatos numa lista só: a agenda do WhatsApp conectado, os cadastrados no sistema, quem tem conversa no privado e a equipe."
      />
      {!allowed ? (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Desligado nesta empresa"
            description="Os contatos usam o módulo de conversas privadas. Quem administra a plataforma liga em Empresas › Conversas privadas."
          />
        </Card>
      ) : (
        <>
          <ContactsSync
            status={rows.some((r) => r.contacts_sync_status === 'syncing') ? 'syncing' : (latest?.contacts_sync_status ?? null)}
            syncedAt={latest?.contacts_synced_at ?? null}
            count={contacts ?? 0}
            named={named ?? 0}
          />
          <ContactsBook tags={(tagRows ?? []) as CustomerTag[]} />
        </>
      )}
    </div>
  );
}
