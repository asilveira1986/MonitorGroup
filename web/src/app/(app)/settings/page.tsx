import { AdminNotice } from '@/components/admin-notice';
import { Card, CardHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { GeneralForm } from './general-form';
import { DemandSettings } from './demand-settings';
import { Holidays } from './holidays';
import { MediaSettings, type MediaUsage } from './media-settings';
import { ReplySettings } from './reply-settings';

export default async function GeneralSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: holidays }, { data: usage }] = await Promise.all([
    supabase.from('app_settings').select('*').single(),
    supabase.from('holidays').select('day, name').order('day'),
    supabase.rpc('media_usage'),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Configurações gerais"
          description="Horário comercial e importação de histórico usados nos indicadores e nos alertas."
        />
        <div className="p-5">
          {profile.role !== 'admin' && <AdminNotice />}
          <GeneralForm settings={data as AppSettings} disabled={profile.role !== 'admin'} />
        </div>
      </Card>
      <ReplySettings settings={data as AppSettings} disabled={profile.role !== 'admin'} />
      <MediaSettings settings={data as AppSettings} usage={(usage as MediaUsage | null) ?? null} disabled={profile.role !== 'admin'} />
      <DemandSettings settings={data as AppSettings} disabled={profile.role !== 'admin'} />
      <Holidays holidays={holidays ?? []} isAdmin={profile.role === 'admin'} />
    </div>
  );
}
