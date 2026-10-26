import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { RetentionCard, TitularRequests } from './lgpd-tools';

/** Organização › Privacidade (LGPD): prazo de guarda e pedidos dos titulares (0096). */
export default async function LgpdPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const { data } = await (await createClient()).from('app_settings').select('message_retention_months').maybeSingle();
  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <RetentionCard months={(data as { message_retention_months?: number | null } | null)?.message_retention_months ?? null} disabled={!isAdmin} />
      {isAdmin && <TitularRequests />}
    </div>
  );
}
