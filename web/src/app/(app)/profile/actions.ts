'use server';

import { createECDH } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
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

/**
 * Chave pública das notificações push (0098). Se ainda não existe (worker ainda não atualizado),
 * o próprio painel gera o par de chaves VAPID (P-256), igual ao worker faria.
 */
export async function ensurePushPublicKey(): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  await requireProfile();
  const { data: existing } = await (await createClient()).rpc('push_public_key');
  if (existing) return { ok: true, key: existing as string };
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const host = (await headers()).get('host');
  const admin = createAdminClient();
  const { error } = await admin.from('push_config').upsert(
    {
      id: 1,
      public_key: ecdh.getPublicKey().toString('base64url'),
      // 32 bytes sempre (a chave pode vir com zeros à esquerda a menos)
      private_key: Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString('base64url'),
      subject: host && !host.startsWith('localhost') ? `https://${host}` : 'mailto:suporte@monitorgroup.app',
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  const { data } = await admin.from('push_config').select('public_key').eq('id', 1).maybeSingle();
  return data?.public_key ? { ok: true, key: data.public_key } : { ok: false, error: 'Não foi possível gerar as chaves das notificações.' };
}
