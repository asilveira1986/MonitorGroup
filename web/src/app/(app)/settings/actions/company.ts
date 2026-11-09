'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createClient } from '@/lib/supabase/server';

export async function saveGeneralSettings(form: FormData): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      company_name: String(form.get('company_name') || 'Minha Empresa'),
      timezone: String(form.get('timezone') || 'America/Sao_Paulo'),
      business_days: form.getAll('business_days').map(Number),
      business_start: String(form.get('business_start') || '08:00'),
      business_end: String(form.get('business_end') || '18:00'),
      auto_monitor_new_groups: form.get('auto_monitor_new_groups') === 'on',
      history_import_days: [0, 7, 30, 60, 90].includes(Number(form.get('history_import_days')))
        ? Number(form.get('history_import_days'))
        : 30,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/** Administradores como responsáveis de todos os grupos (0162): liga ou desliga na hora, sem passar pelo formulário geral. */
export async function setAdminsResponsibleAll(enabled: boolean): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ admins_responsible_all: Boolean(enabled), updated_at: new Date().toISOString() })
    .eq('company_id', admin.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function addHoliday(form: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const day = String(form.get('day') ?? '');
  const name = String(form.get('name') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !name) return { ok: false, error: 'Informe a data e o nome do feriado.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('holidays')
    .upsert({ company_id: admin.company_id, day, name, created_by: admin.id }, { onConflict: 'company_id,day' });
  revalidatePath('/settings');
  return result(error);
}

export async function removeHoliday(day: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').delete().eq('day', day);
  revalidatePath('/settings');
  return result(error);
}

/** Horário comercial editado a partir do indicador (mesmo cadastro de Configurações › Empresa). */
export async function saveBusinessHours(values: { days: number[]; start: string; end: string }): Promise<Result> {
  await requireAdmin();
  if (!/^\d{2}:\d{2}/.test(values.start) || !/^\d{2}:\d{2}/.test(values.end)) {
    return { ok: false, error: 'Informe o início e o fim do expediente.' };
  }
  if (values.start >= values.end) return { ok: false, error: 'O fim do expediente deve ser depois do início.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      business_days: values.days.filter((d) => d >= 0 && d <= 6),
      business_start: values.start,
      business_end: values.end,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}
