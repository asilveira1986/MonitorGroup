'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type PersonSummary = {
  telefone: string;
  nomes: string[];
  grupos: number;
  mensagens_grupos: number;
  conversas_privadas: number;
  mensagens_privadas: number;
  contatos: number;
  reacoes: number;
  atendente: boolean;
};

/** Prazo de guarda das mensagens (meses; null = sem prazo). */
export async function saveMessageRetention(months: number | null): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ message_retention_months: months, updated_at: new Date().toISOString() })
    .eq('company_id', admin.company_id);
  revalidatePath('/settings/lgpd');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** O que existe da pessoa (fica no log). */
export async function lgpdSummary(phone: string): Promise<Result<PersonSummary>> {
  await requireAdmin();
  const { data, error } = await (await createClient()).rpc('lgpd_person_summary', { p_phone: phone });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, data: data as PersonSummary };
}

/** Apaga os dados da pessoa e os arquivos dela no Storage (fica no log). */
export async function lgpdErase(phone: string): Promise<Result<{ mensagens_grupos: number; conversas_privadas: number; participacoes: number; arquivos: number }>> {
  await requireAdmin();
  const { data, error } = await (await createClient()).rpc('lgpd_person_erase', { p_phone: phone });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  const r = data as { mensagens_grupos: number; conversas_privadas: number; participacoes: number; arquivos: string[] };
  const files = (r.arquivos ?? []).filter(Boolean);
  for (let i = 0; i < files.length; i += 200) await createAdminClient().storage.from('media').remove(files.slice(i, i + 200));
  revalidatePath('/', 'layout');
  return { ok: true, data: { ...r, arquivos: files.length } };
}
