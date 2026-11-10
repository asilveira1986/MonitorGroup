import { AdminNotice } from '@/components/admin-notice';
import { appSettings } from '@/lib/app-settings';
import { requireProfile } from '@/lib/auth';
import type { AppSettings } from '@/lib/types';
import { FollowupSettings } from '../followup-settings';
import { IgnoreSettings } from '../ignore-settings';
import { ReplySettings } from '../reply-settings';

// salvar "Mensagens a ignorar" reavalia as mensagens já recebidas (pode levar alguns segundos)
export const maxDuration = 60;

/** Atendimento › Respostas e mensagens: responder pelo sistema e as mensagens a ignorar. */
export default async function ServiceSettingsPage() {
  const profile = await requireProfile();
  const { data } = await appSettings();
  const disabled = profile.role !== 'admin';
  return (
    <div className="space-y-4">
      {disabled && <AdminNotice />}
      <ReplySettings settings={data as AppSettings} disabled={disabled} />
      <IgnoreSettings settings={data as AppSettings} disabled={disabled} />
      <FollowupSettings settings={data as AppSettings} disabled={disabled} />
    </div>
  );
}
