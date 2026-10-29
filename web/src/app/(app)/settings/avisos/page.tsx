import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule, AppSettings } from '@/lib/types';
import type { VoiceEvent } from '@/lib/voice';
import { VoiceSettings } from '../alerts/voice-settings';
import { MessageAlertSettings } from '../message-alert-settings';
import { PrivateAlertSettings } from '../private-alert-settings';

/** Monitoramento › Avisos: como avisar na tela (aviso, tempo, som) e por voz. */
export default async function NoticeSettingsPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [{ data: settings }, { data: rules }, { data: privateOk }] = await Promise.all([
    supabase.from('app_settings').select('*').maybeSingle(),
    supabase.from('alert_rules').select('voice'),
    // conversas privadas ligadas na empresa (e o banco com o script 0120): a seção própria
    supabase.rpc('can_use_private_chats'),
  ]);
  const s = settings as AppSettings | null;
  const list = (rules ?? []) as Pick<AlertRule, 'voice'>[];
  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      {s && <MessageAlertSettings settings={s} disabled={!isAdmin} />}
      {s && privateOk && s.private_alert_mine !== undefined && <PrivateAlertSettings settings={s} disabled={!isAdmin} />}
      <VoiceSettings
        initial={{
          voice: s?.msg_alert_voice ?? true,
          messages: s?.msg_alert_voice_messages ?? true,
          sla: s?.msg_alert_voice_sla ?? true,
          templates: (s?.msg_alert_voice_templates ?? {}) as Partial<Record<VoiceEvent, string>>,
          voiceName: s?.msg_alert_voice_name ?? null,
          rate: Number(s?.msg_alert_voice_rate ?? 1),
          pitch: Number(s?.msg_alert_voice_pitch ?? 1),
        }}
        disabled={!isAdmin}
        rulesWithVoice={list.filter((r) => r.voice !== false).length}
        rulesTotal={list.length}
      />
    </div>
  );
}
