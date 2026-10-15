import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule } from '@/lib/types';
import { RulesPanel } from './rules';
import { VoiceSettings } from './voice-settings';

export default async function AlertRulesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: rules }, { data: groups }, { data: settings }] = await Promise.all([
    supabase.from('alert_rules').select('*').order('created_at'),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    supabase.from('app_settings').select('msg_alert_voice, msg_alert_voice_messages, msg_alert_voice_sla').maybeSingle(),
  ]);
  const list = (rules ?? []) as AlertRule[];
  return (
    <>
      {profile.role !== 'admin' && <AdminNotice />}
      <div className="space-y-4">
        <VoiceSettings
          initial={{
            voice: settings?.msg_alert_voice ?? true,
            messages: settings?.msg_alert_voice_messages ?? true,
            sla: settings?.msg_alert_voice_sla ?? true,
          }}
          disabled={profile.role !== 'admin'}
          rulesWithVoice={list.filter((r) => r.voice !== false).length}
          rulesTotal={list.length}
        />
        <RulesPanel rules={list} groups={groups ?? []} isAdmin={profile.role === 'admin'} />
      </div>
    </>
  );
}
