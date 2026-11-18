import { AlertTriangle, BellRing } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import type { NotificationRow } from '@/lib/notification-status';
import { createClient } from '@/lib/supabase/server';
import { NotificationList } from './notification-list';

export const metadata: Metadata = { title: 'Monitor Group · Notificações' };

/** Situação das notificações de cada usuário (administrador geral): avisos ligados, push, último acesso. */
export default async function NotificationsPage() {
  await requirePlatformAdmin();
  const { data, error } = await (await createClient()).rpc('platform_notification_status');
  const missing = Boolean(error && /platform_notification_status/.test(error.message));
  return (
    <>
      <PageHeader
        title="Notificações dos usuários"
        description="Quem está recebendo os avisos: alerta em tela e som (com o sistema aberto) e push (chega até com o sistema fechado)."
      />
      {error ? (
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title={missing ? 'Falta aplicar o script do banco (item 0189)' : 'Não foi possível carregar'}
          description={missing ? 'Rode o atualizar_banco_parte2.sql no Supabase e atualize a página.' : error.message}
        />
      ) : !(data as NotificationRow[] | null)?.length ? (
        <EmptyState icon={<BellRing className="size-5" />} title="Nenhum usuário ativo" />
      ) : (
        <NotificationList rows={data as NotificationRow[]} />
      )}
    </>
  );
}
