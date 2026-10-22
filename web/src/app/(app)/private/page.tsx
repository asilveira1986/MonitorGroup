import { Lock, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PrivateInbox, type PrivateChat } from './inbox';

export const metadata: Metadata = { title: 'Monitor Group · Conversas privadas' };

/**
 * Conversas privadas (1 a 1) do WhatsApp conectado: receber, responder e iniciar conversas com um
 * contato salvo ou um número novo. Nesta fase, só para quem administra a plataforma (0069).
 */
export default async function PrivatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireProfile();
  if (!profile.platform_admin) redirect('/dashboard');
  const supabase = await createClient();
  const [{ data: allowed }, { data: chats }, { data: settings }, { data: instance }] = await Promise.all([
    supabase.rpc('can_use_private_chats'),
    supabase.from('private_chats').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(300),
    supabase.from('app_settings').select('timezone').maybeSingle(),
    supabase.from('whatsapp_instances').select('status').eq('status', 'connected').limit(1).maybeSingle(),
  ]);
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
          <PrivateInbox
            initialChats={(chats ?? []) as PrivateChat[]}
            selectedId={typeof sp.c === 'string' ? sp.c : null}
            timeZone={settings?.timezone ?? 'America/Sao_Paulo'}
          />
        </>
      )}
    </div>
  );
}
