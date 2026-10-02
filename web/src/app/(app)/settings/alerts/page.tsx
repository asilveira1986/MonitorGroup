import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule } from '@/lib/types';
import { RulesPanel } from './rules';

export default async function AlertRulesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: rules }, { data: groups }] = await Promise.all([
    supabase.from('alert_rules').select('*').order('created_at'),
    supabase.from('groups').select('id, name').eq('monitored', true).order('name'),
  ]);
  return (
    <>
      {profile.role !== 'admin' && <AdminNotice />}
      <RulesPanel rules={(rules ?? []) as AlertRule[]} groups={groups ?? []} isAdmin={profile.role === 'admin'} />
    </>
  );
}
