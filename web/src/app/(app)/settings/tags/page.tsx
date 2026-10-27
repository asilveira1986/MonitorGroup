import type { CustomerTag } from '@/components/customer-tags';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CustomerTags } from './tags';

/** Organização › Etiquetas (0103): as etiquetas para marcar os clientes nos grupos e no privado. */
export default async function CustomerTagsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: tags }, { data: groups }, { data: chats }] = await Promise.all([
    supabase.from('customer_tags').select('id, name, color').order('name'),
    supabase.from('groups').select('tags').not('tags', 'eq', '{}').limit(5000),
    supabase.from('private_chats').select('tags').not('tags', 'eq', '{}').limit(5000),
  ]);
  const count = new Map<string, number>();
  for (const r of [...(groups ?? []), ...(chats ?? [])] as { tags: string[] }[]) for (const t of r.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return <CustomerTags types={(tags ?? []) as CustomerTag[]} usage={Object.fromEntries(count)} />;
}
