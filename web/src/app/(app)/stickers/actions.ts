'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult as Result } from '@/lib/action-result';
import { requireAdmin, requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isStickerPath, stickerName, stickerPath, validateStickerFile, STICKER_MIME } from '@/lib/stickers';

/** Figurinha da biblioteca da empresa (0160). */
export type StickerItem = { id: string; name: string | null; favorite: boolean; source: string; size: number };
/** Figurinha recebida no grupo (guardada na mensagem). */
export type ReceivedSticker = { id: string; senderName: string | null; sentAt: string };

const LIMIT_LIBRARY = 300;
const LIMIT_RECEIVED = 40;

/** Lê a biblioteca (favoritas primeiro) e as últimas figurinhas recebidas neste grupo. */
export async function loadStickers(groupId: string): Promise<{ ok: true; library: StickerItem[]; received: ReceivedSticker[] } | { ok: false; error: string }> {
  await requireProfile();
  const supabase = await createClient();
  const [lib, rec] = await Promise.all([
    supabase
      .from('stickers')
      .select('id, name, favorite, source, media_size')
      .order('favorite', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT_LIBRARY),
    supabase
      .from('messages')
      .select('id, sender_name, sent_at')
      .eq('group_id', groupId)
      .eq('message_type', 'sticker')
      .not('media_path', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(LIMIT_RECEIVED),
  ]);
  if (lib.error) return { ok: false, error: friendlyDbError(lib.error.message) };
  return {
    ok: true,
    library: ((lib.data ?? []) as { id: string; name: string | null; favorite: boolean; source: string; media_size: number | null }[]).map((s) => ({
      id: s.id,
      name: s.name,
      favorite: s.favorite,
      source: s.source,
      size: Number(s.media_size ?? 0),
    })),
    received: ((rec.data ?? []) as { id: string; sender_name: string | null; sent_at: string }[]).map((m) => ({ id: m.id, senderName: m.sender_name, sentAt: m.sent_at })),
  };
}

/** Prepara o envio de uma figurinha nova para a biblioteca: link de upload direto para o Storage (só .webp de até 1 MB). */
export async function prepareStickerUpload(file: { mime: string; size: number }): Promise<{ ok: true; data: { path: string; token: string } } | { ok: false; error: string }> {
  const profile = await requireProfile();
  if (profile.role === 'viewer') return { ok: false, error: 'Seu perfil é somente para ver os painéis.' };
  const checked = validateStickerFile(file);
  if (!checked.ok) return checked;
  if (!profile.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  const path = stickerPath(profile.company_id, crypto.randomUUID());
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio da figurinha.' };
  return { ok: true, data: { path, token: data.token } };
}

/** Registra na biblioteca a figurinha que acabou de subir para o Storage. */
export async function addSticker(input: { path: string; size: number; name?: string }): Promise<Result> {
  const profile = await requireProfile();
  if (!profile.company_id || !isStickerPath(profile.company_id, input.path)) return { ok: false, error: 'Arquivo inválido.' };
  const checked = validateStickerFile({ mime: STICKER_MIME, size: input.size });
  if (!checked.ok) return checked;
  const supabase = await createClient();
  const { error } = await supabase.from('stickers').insert({
    company_id: profile.company_id,
    media_path: input.path,
    media_size: checked.value.size,
    name: stickerName(input.name),
    source: 'upload',
  });
  revalidatePath('/', 'layout');
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Guarda na biblioteca uma figurinha recebida num grupo: copia o arquivo para a pasta da empresa (não some com a limpeza das mensagens). */
export async function saveReceivedSticker(messageId: string): Promise<Result> {
  const profile = await requireProfile();
  if (profile.role === 'viewer') return { ok: false, error: 'Seu perfil é somente para ver os painéis.' };
  if (!profile.company_id) return { ok: false, error: 'Empresa não encontrada.' };
  const supabase = await createClient();
  const { data: message } = await supabase
    .from('messages')
    .select('id, media_path, message_type, media_size, sender_name')
    .eq('id', messageId)
    .maybeSingle();
  if (!message?.media_path || message.message_type !== 'sticker') return { ok: false, error: 'Figurinha não encontrada.' };
  const to = stickerPath(profile.company_id, crypto.randomUUID());
  const copy = await createAdminClient().storage.from('media').copy(message.media_path as string, to);
  if (copy.error) return { ok: false, error: 'Não foi possível copiar a figurinha.' };
  const { error } = await supabase.from('stickers').insert({
    company_id: profile.company_id,
    media_path: to,
    media_size: Number(message.media_size ?? 0),
    name: stickerName(message.sender_name ? `de ${message.sender_name}` : null),
    source: 'received',
    favorite: false,
  });
  if (error) {
    // não deixa o arquivo copiado órfão
    await createAdminClient().storage.from('media').remove([to]);
    return { ok: false, error: friendlyDbError(error.message) };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function setStickerFavorite(id: string, favorite: boolean): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from('stickers').update({ favorite }).eq('id', id);
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}

/** Só administradores excluem da biblioteca (o arquivo sai do Storage também). */
export async function deleteSticker(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: row } = await supabase.from('stickers').select('media_path').eq('id', id).maybeSingle();
  const { error } = await supabase.from('stickers').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  if (row?.media_path) await createAdminClient().storage.from('media').remove([row.media_path as string]);
  return { ok: true };
}

/**
 * Envia uma figurinha no grupo: da biblioteca da empresa ou uma recebida no próprio grupo. Vai para a fila de
 * respostas (o worker envia pelo número conectado, como figurinha).
 */
export async function sendSticker(
  groupId: string,
  source: { kind: 'library' | 'message'; id: string },
  quotedMessageId: string | null,
): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  let path: string | null = null;
  let size = 0;
  if (source.kind === 'library') {
    const { data } = await supabase.from('stickers').select('media_path, media_size').eq('id', source.id).maybeSingle();
    path = (data?.media_path as string | undefined) ?? null;
    size = Number(data?.media_size ?? 0);
  } else {
    const { data } = await supabase
      .from('messages')
      .select('media_path, media_size, message_type')
      .eq('id', source.id)
      .eq('group_id', groupId)
      .maybeSingle();
    if (data?.message_type === 'sticker') {
      path = (data.media_path as string | null) ?? null;
      size = Number(data.media_size ?? 0);
    }
  }
  if (!path) return { ok: false, error: 'Figurinha não encontrada.' };
  const { error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_body: '',
    p_quoted_message_id: quotedMessageId,
    p_closes: false,
    p_media: { path, type: 'sticker', mime: STICKER_MIME, size, name: 'figurinha.webp' },
  });
  return error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
}
