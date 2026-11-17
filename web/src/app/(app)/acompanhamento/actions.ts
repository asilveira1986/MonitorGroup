'use server';

import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

export type UserActivity = { at: string; category: string; action: string; entity: string; summary: string };

/**
 * Últimas atividades de um usuário (as do Log: configurações, grupos, respostas, demandas, alertas...).
 * Administrador da plataforma: de qualquer usuário; administrador da empresa: só da própria (0180).
 */
export async function recentUserActivity(email: string): Promise<{ ok: true; items: UserActivity[] } | { ok: false; error: string }> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('user_recent_activity', { p_email: email, p_limit: 40 });
  if (!error) return { ok: true, items: (data ?? []) as UserActivity[] };
  // sem o script 0180 a função não existe: o administrador da plataforma lê o Log direto
  if (/user_recent_activity/.test(error.message) && me.platform_admin) {
    const { data: rows, error: e2 } = await supabase
      .from('activity_log')
      .select('created_at, category, action, entity, summary')
      .ilike('user_email', email)
      .order('created_at', { ascending: false })
      .limit(40);
    if (e2) return { ok: false, error: friendlyDbError(e2.message) };
    return { ok: true, items: (rows ?? []).map((r) => ({ at: r.created_at as string, category: r.category as string, action: r.action as string, entity: r.entity as string, summary: r.summary as string })) };
  }
  if (/user_recent_activity/.test(error.message)) return { ok: false, error: 'Falta aplicar o script do banco (item 0180).' };
  return { ok: false, error: friendlyDbError(error.message) };
}
