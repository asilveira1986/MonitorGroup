'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { MENU_ITEMS } from '@/lib/menu';
import { createClient } from '@/lib/supabase/server';

/** Quem vê cada item do menu lateral: todos, só administradores ou ninguém. */
export async function saveMenuAccess(access: Record<string, 'all' | 'admin' | 'none'>): Promise<Result> {
  const admin = await requireAdmin();
  const allowed = new Set(MENU_ITEMS.map((i) => i.href as string));
  const clean = Object.fromEntries(
    Object.entries(access).filter(
      ([href, v]) => allowed.has(href) && (v === 'admin' || v === 'none') && !(href === '/settings' && v === 'none'),
    ),
  );
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ menu_access: clean, updated_at: new Date().toISOString() })
    .eq('company_id', admin.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}
