import { AdminNotice } from '@/components/admin-notice';
import { Card, CardHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { GeneralForm } from './general-form';
import { Holidays } from './holidays';

/** Organização › Empresa: horário comercial, histórico e feriados. */
export default async function CompanySettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: holidays }] = await Promise.all([
    supabase.from('app_settings').select('*').single(),
    supabase.from('holidays').select('day, name').order('day'),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Empresa"
          description="Horário comercial e importação de histórico, usados nos indicadores e nos alertas."
        />
        <div className="p-5">
          {profile.role !== 'admin' && <AdminNotice />}
          <GeneralForm settings={data as AppSettings} disabled={profile.role !== 'admin'} />
        </div>
      </Card>
      <Holidays holidays={holidays ?? []} isAdmin={profile.role === 'admin'} />
    </div>
  );
}
