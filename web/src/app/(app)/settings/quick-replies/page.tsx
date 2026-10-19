import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import type { QuickReply } from '@/lib/quick-replies';
import { createClient } from '@/lib/supabase/server';
import { QuickReplies } from './quick-replies';

export default async function QuickRepliesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.from('quick_replies').select('id, shortcut, title, body').order('shortcut');
  return (
    <div className="space-y-4">
      {profile.role !== 'admin' && <AdminNotice />}
      <QuickReplies
        initial={(data ?? []) as QuickReply[]}
        canEdit={profile.role === 'admin'}
        missingTable={Boolean(error && /quick_replies/.test(error.message))}
      />
    </div>
  );
}
