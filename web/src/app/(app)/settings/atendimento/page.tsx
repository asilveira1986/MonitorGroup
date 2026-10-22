import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { IgnoreSettings } from '../ignore-settings';
import { ReplySettings } from '../reply-settings';

// salvar "Mensagens a ignorar" reavalia as mensagens já recebidas (pode levar alguns segundos)
export const maxDuration = 60;

/** Atendimento › Respostas e mensagens: responder pelo sistema e as mensagens a ignorar. */
export default async function ServiceSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('*').single();
  const disabled = profile.role !== 'admin';
  return (
    <div className="space-y-4">
      {disabled && <AdminNotice />}
      <ReplySettings settings={data as AppSettings} disabled={disabled} />
      <IgnoreSettings settings={data as AppSettings} disabled={disabled} />
    </div>
  );
}
