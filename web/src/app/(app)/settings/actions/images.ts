'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const IMAGE_MAX = 2 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

/**
 * Logo da empresa ou foto do atendente (0083): devolve um link de upload direto para o Storage
 * (bucket privado, pasta da empresa); o arquivo não passa pelo servidor do painel.
 */
export async function prepareImageUpload(
  kind: 'logo' | 'team',
  file: { mime: string; size: number },
): Promise<{ ok: true; data: { path: string; token: string } } | { ok: false; error: string }> {
  const profile = kind === 'logo' ? await requireAdmin() : await requireProfile();
  const ext = IMAGE_TYPES[file.mime];
  if (!ext) return { ok: false, error: 'Envie uma imagem PNG, JPG, WEBP, SVG ou GIF.' };
  if (file.size > IMAGE_MAX) return { ok: false, error: 'A imagem passa de 2 MB.' };
  if (!profile.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  const path = `${profile.company_id}/${kind === 'logo' ? 'branding' : 'team'}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio da imagem.' };
  return { ok: true, data: { path, token: data.token } };
}

/** Grava (ou tira, com null) o logo da empresa. */
export async function saveCompanyLogo(path: string | null): Promise<Result> {
  await requireAdmin();
  const { error } = await (await createClient()).rpc('set_company_logo', { p_path: path });
  revalidatePath('/', 'layout');
  return result(error);
}

/** Grava (ou tira, com null) a foto do atendente. */
export async function saveTeamPhoto(memberId: string, path: string | null): Promise<Result> {
  await requireProfile();
  const { error } = await (await createClient()).rpc('set_team_member_photo', { p_member_id: memberId, p_path: path });
  revalidatePath('/settings/people');
  return result(error);
}
