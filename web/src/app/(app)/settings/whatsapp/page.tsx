import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings, Instance } from '@/lib/types';
import { MediaSettings, type MediaUsage } from '../media-settings';
import { InstancesPanel } from './instances';

export default async function WhatsAppSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: settings }, { data: usage }] = await Promise.all([
    supabase.from('whatsapp_instances').select('*').order('created_at'),
    supabase.from('app_settings').select('*').single(),
    supabase.rpc('media_usage'),
  ]);

  return (
    <div className="space-y-4">
      {profile.role !== 'admin' && <AdminNotice />}
      <InstancesPanel initial={(data ?? []) as Instance[]} isAdmin={profile.role === 'admin'} />
      {settings && (
        <MediaSettings settings={settings as AppSettings} usage={(usage as MediaUsage | null) ?? null} disabled={profile.role !== 'admin'} />
      )}
    </div>
  );
}
