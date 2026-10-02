import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Instance } from '@/lib/types';
import { InstancesPanel } from './instances';

export default async function WhatsAppSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from('whatsapp_instances').select('*').order('created_at');

  return (
    <>
      {profile.role !== 'admin' && <AdminNotice />}
      <InstancesPanel initial={(data ?? []) as Instance[]} isAdmin={profile.role === 'admin'} />
    </>
  );
}
