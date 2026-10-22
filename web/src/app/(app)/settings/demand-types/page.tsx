import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { DEFAULT_DEMAND_TYPES } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { DemandSettings } from '../demand-settings';
import { DemandTypes, type DemandType } from './demand-types';

/** Cadastro dos tipos de demanda (as categorias do indicador "Tipo de demanda"). */
export default async function DemandTypesPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [{ data: ind }, { data: used }, { data: settings }] = await Promise.all([
    supabase.from('my_indicators').select('params').eq('key', 'tipo_demanda').maybeSingle(),
    supabase.from('demands').select('type').not('type', 'is', null).limit(20000),
    supabase.from('app_settings').select('*').single(),
  ]);
  const categories = (ind?.params as { categories?: DemandType[] } | undefined)?.categories;
  const types: DemandType[] = categories?.length
    ? categories.map((c) => ({ name: c.name ?? '', keywords: Array.isArray(c.keywords) ? c.keywords : [] }))
    : DEFAULT_DEMAND_TYPES.map((name) => ({ name, keywords: [] }));
  const counts: Record<string, number> = {};
  for (const r of (used ?? []) as { type: string }[]) counts[r.type] = (counts[r.type] ?? 0) + 1;

  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <DemandTypes initial={types} counts={counts} canEdit={isAdmin} />
      {settings && <DemandSettings settings={settings as AppSettings} disabled={!isAdmin} />}
    </div>
  );
}
