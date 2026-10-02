import { AdminNotice } from '@/components/admin-notice';
import { Card, CardHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { GeneralForm } from './general-form';

export default async function GeneralSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single();

  return (
    <Card>
      <CardHeader
        title="Configurações gerais"
        description="Horário comercial e SLA padrão usados nas métricas e nos alertas."
      />
      <div className="p-5">
        {profile.role !== 'admin' && <AdminNotice />}
        <GeneralForm settings={data as AppSettings} disabled={profile.role !== 'admin'} />
      </div>
    </Card>
  );
}
