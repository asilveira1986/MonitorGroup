'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createClient } from '@/lib/supabase/server';

/** Salva os tipos de demanda (categorias do indicador "Tipo de demanda") e renomeia nas demandas. */
export async function saveDemandTypes(
  types: { name: string; keywords: string[] }[],
  renames: { from: string; to: string }[],
): Promise<Result & { renamed?: number }> {
  await requireAdmin();
  const clean = types
    .map((t) => ({
      name: t.name.trim().replace(/\s+/g, ' ').slice(0, 60),
      keywords: [...new Set(t.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 100),
    }))
    .filter((t) => t.name);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_indicator', {
    p_key: 'tipo_demanda',
    p_enabled: null,
    p_alert_enabled: null,
    p_params: { categories: clean },
  });
  if (error) return result(error);
  let renamed = 0;
  for (const r of renames) {
    const { data, error: e } = await supabase.rpc('rename_demand_type', { p_old: r.from, p_new: r.to });
    if (e) return result(e);
    renamed += Number(data ?? 0);
  }
  revalidatePath('/', 'layout');
  return { ok: true, renamed };
}
