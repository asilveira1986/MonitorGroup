import { AlertTriangle, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { CustomerTag } from '@/components/customer-tags';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import type { BroadcastTrigger } from '@/lib/broadcast';
import { appSettings } from '@/lib/app-settings';
import { createClient } from '@/lib/supabase/server';
import type { InstanceOption } from '../new/new-broadcast';
import { Triggers } from './triggers';

export const metadata: Metadata = { title: 'Monitor Group · Gatilhos de disparo' };

/**
 * Gatilhos (0153): mensagens automáticas quando alguém recebe uma etiqueta ou faz aniversário. Cada vez
 * que a regra vale para alguém, o sistema cria um envio normal (com o mesmo ritmo e o opt-out dos disparos).
 */
export default async function TriggersPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [triggers, tags, instances, birthdays, settings] = await Promise.all([
    supabase.from('broadcast_triggers').select('*').order('created_at', { ascending: false }),
    supabase.from('customer_tags').select('id, name, color').order('name'),
    supabase.from('whatsapp_instances').select('id, name, phone, status').order('name'),
    // sem o script 0153 a coluna não existe: contagem indisponível
    supabase.from('contacts').select('id', { count: 'exact', head: true }).not('birthday', 'is', null),
    appSettings(),
  ]);

  if (triggers.error) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Falta atualizar o banco de dados"
          description="Rode no SQL Editor do Supabase o script supabase/atualizar_banco_parte2.sql (item 0153) e recarregue esta página."
        />
      </Card>
    );
  }

  return (
    <div data-wide className="space-y-6">
      <PageHeader
        title="Gatilhos de disparo"
        description="Mensagens automáticas: quando alguém recebe uma etiqueta, ou no aniversário do contato. Cada pessoa recebe uma vez por regra (aniversário: uma vez por ano)."
        action={
          <Link href="/broadcasts" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2">
            <ArrowLeft className="h-4 w-4" /> Disparos
          </Link>
        }
      />
      <Triggers
        items={(triggers.data ?? []) as BroadcastTrigger[]}
        tags={(tags.data ?? []) as CustomerTag[]}
        instances={(instances.data ?? []) as InstanceOption[]}
        birthdays={birthdays.error ? null : (birthdays.count ?? 0)}
        timezone={(settings.data as { timezone?: string } | null)?.timezone || 'America/Sao_Paulo'}
      />
    </div>
  );
}
