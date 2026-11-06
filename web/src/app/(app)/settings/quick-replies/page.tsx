import { AdminNotice } from '@/components/admin-notice';
import { appSettings } from '@/lib/app-settings';
import { requireProfile } from '@/lib/auth';
import type { QuickReply } from '@/lib/quick-replies';
import { createClient } from '@/lib/supabase/server';
import { QuickReplies } from './quick-replies';

export default async function QuickRepliesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data, error }, { data: cfg }] = await Promise.all([
    supabase.from('quick_replies').select('id, shortcut, title, body').order('shortcut'),
    appSettings(),
  ]);
  return (
    <div className="space-y-4">
      {profile.role !== 'admin' && <AdminNotice />}
      <QuickReplies
        initial={(data ?? []) as QuickReply[]}
        canEdit={profile.role === 'admin'}
        missingTable={Boolean(error && /quick_replies/.test(error.message))}
        closingShortcut={(cfg as { closing_shortcut?: string } | null)?.closing_shortcut ?? 'fechamento'}
      />
    </div>
  );
}
