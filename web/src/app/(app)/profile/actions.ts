'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };
const result = (error: { message: string } | null | undefined): Result =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Meu perfil (0085): nome e telefone. */
export async function updateMyProfile(input: { name: string; phone: string }): Promise<Result> {
  await requireProfile();
  const { error } = await (await createClient()).rpc('update_my_profile', { p_full_name: input.name, p_phone: input.phone || null });
  revalidatePath('/', 'layout');
  return result(error);
}

/** Link de upload direto da foto do perfil (pasta do próprio usuário). */
export async function prepareMyPhoto(file: { mime: string; size: number }): Promise<{ ok: true; data: { path: string; token: string } } | { ok: false; error: string }> {
  const profile = await requireProfile();
  const ext = IMAGE_TYPES[file.mime];
  if (!ext) return { ok: false, error: 'Envie uma foto PNG, JPG, WEBP ou GIF.' };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'A foto passa de 2 MB.' };
  const path = `users/${profile.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio da foto.' };
  return { ok: true, data: { path, token: data.token } };
}

/** Grava (ou tira, com null) a foto do perfil. */
export async function saveMyPhoto(path: string | null): Promise<Result> {
  await requireProfile();
  const { error } = await (await createClient()).rpc('set_my_photo', { p_path: path });
  revalidatePath('/', 'layout');
  return result(error);
}
