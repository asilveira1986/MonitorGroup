import { requirePlatformAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { RetentionCard, TitularRequests } from './lgpd-tools';

/** Organização › Privacidade (LGPD): prazo de guarda e pedidos dos titulares (0096). Só o administrador geral do sistema (0104). */
export default async function LgpdPage() {
  await requirePlatformAdmin();
  const { data } = await (await createClient()).from('app_settings').select('message_retention_months').maybeSingle();
  return (
    <div className="space-y-4">
      <RetentionCard months={(data as { message_retention_months?: number | null } | null)?.message_retention_months ?? null} disabled={false} />
      <TitularRequests />
    </div>
  );
}
