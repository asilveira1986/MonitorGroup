import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import type { CustomerTag } from '@/components/customer-tags';
import { appSettings } from '@/lib/app-settings';
import { requireAdmin } from '@/lib/auth';
import { settingsFromRow } from '@/lib/broadcast';
import { createClient } from '@/lib/supabase/server';
import { NewBroadcast, type GroupOption, type InstanceOption } from './new-broadcast';

export const metadata: Metadata = { title: 'Monitor Group · Novo disparo' };

export default async function NewBroadcastPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [tags, sectors, groups, instances, settings, probe] = await Promise.all([
    supabase.from('customer_tags').select('id, name, color').order('name'),
    supabase.from('sectors').select('id, name').order('name'),
    supabase.from('groups').select('id, name').is('removed_at', null).order('name'),
    supabase.from('whatsapp_instances').select('id, name, phone, status').order('name'),
    appSettings(),
    supabase.from('broadcast_campaigns').select('id', { head: true, count: 'exact' }),
  ]);
  if (probe.error) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Falta atualizar o banco de dados"
          description="Rode no SQL Editor do Supabase o script supabase/atualizar_banco_parte2.sql (item 0150) e recarregue esta página."
        />
      </Card>
    );
  }
  return (
    <div data-wide className="space-y-6">
      <PageHeader title="Novo disparo" description="Escolha quem recebe, escreva a mensagem e envie agora ou agende. Você confere a lista antes de enviar." />
      <NewBroadcast
        tags={(tags.data ?? []) as CustomerTag[]}
        sectors={(sectors.data ?? []) as { id: string; name: string }[]}
        groups={(groups.data ?? []) as GroupOption[]}
        instances={(instances.data ?? []) as InstanceOption[]}
        rate={settingsFromRow(settings.data as Record<string, unknown> | null)}
      />
    </div>
  );
}
