import { AdminNotice } from '@/components/admin-notice';
import { appSettings } from '@/lib/app-settings';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ConnectionPeriod } from '@/lib/connection-history';
import type { AppSettings, Instance } from '@/lib/types';
import { MediaSettings, type MediaUsage } from '../media-settings';
import { ConnectionHistory } from './connection-history';
import { InstancesPanel } from './instances';

export default async function WhatsAppSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: settings }, { data: usage }, { data: sectors }, { data: history, error: historyError }] = await Promise.all([
    supabase.from('whatsapp_instances').select('*').order('created_at'),
    appSettings(),
    supabase.rpc('media_usage'),
    supabase.from('sectors').select('id, name').order('name'),
    // períodos fora do ar dos números (0195): só administradores leem
    supabase.from('whatsapp_connection_log').select('id, instance_id, started_at, ended_at, reason').order('started_at', { ascending: false }).limit(200),
  ]);
  const instances = (data ?? []) as Instance[];
  const now = new Date().getTime();

  return (
    <div className="space-y-4">
      {profile.role !== 'admin' && <AdminNotice />}
      <InstancesPanel initial={instances} isAdmin={profile.role === 'admin'} sectors={(sectors ?? []) as { id: string; name: string }[]} />
      {profile.role === 'admin' && !historyError && (
        <ConnectionHistory periods={(history ?? []) as ConnectionPeriod[]} instances={instances} timeZone={settings?.timezone} now={now} />
      )}
      {settings && (
        <MediaSettings settings={settings as AppSettings} usage={(usage as MediaUsage | null) ?? null} disabled={profile.role !== 'admin'} />
      )}
    </div>
  );
}
