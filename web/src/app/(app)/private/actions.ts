'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: { message: string }) => ({ ok: false as const, error: friendlyDbError(e.message) });

/** Abre (ou acha) a conversa com um contato salvo (jid) ou um número novo (phone). */
export async function startPrivateChat(input: { jid?: string; phone?: string; name?: string }): Promise<Result<{ id: string }>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_private_chat', {
    p_jid: input.jid ?? null,
    p_phone: input.phone ?? null,
    p_name: input.name ?? null,
  });
  if (error) return fail(error);
  revalidatePath('/private');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export type PrivateMedia = {
  path: string;
  type: 'image' | 'video' | 'audio' | 'document';
  mime: string;
  name: string;
  size: number;
  /** áudio gravado no painel: vai como mensagem de voz (0074) */
  voice?: boolean;
};

/** Envia pelo número conectado (o worker confere se o número tem WhatsApp): texto ou arquivo com legenda, citando ou não. */
export async function sendPrivateMessage(
  chatId: string,
  body: string,
  opts: { quotedId?: string | null; media?: PrivateMedia | null } = {},
): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_private_message', {
    p_chat_id: chatId,
    p_body: body,
    p_quoted_message_id: opts.quotedId ?? null,
    p_media: opts.media ?? null,
  });
  return error ? fail(error) : { ok: true };
}

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Prepara o envio de um arquivo: confere a conversa (com a sessão do usuário) e devolve um link
 * de upload direto para o Storage, na pasta da conversa (o arquivo não passa pelo servidor).
 */
export async function preparePrivateUpload(chatId: string, file: { name: string; mime: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  await requireProfile();
  if (file.size > MAX_BYTES) return { ok: false, error: 'O arquivo passa de 50 MB.' };
  const supabase = await createClient();
  const { data: chat } = await supabase.from('private_chats').select('id, company_id').eq('id', chatId).maybeSingle();
  if (!chat) return { ok: false, error: 'Conversa não encontrada.' };
  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : file.mime.split('/')[1] ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const path = `${chat.company_id}/private/${chat.id}/out-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from('media').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio do arquivo.' };
  return { ok: true, data: { path, token: data.token } };
}

/** Editar, apagar (para todos / para mim) ou reagir: o worker faz no WhatsApp. */
export async function requestPrivateAction(
  messageId: string,
  action: 'edit' | 'delete' | 'delete_me' | 'react',
  extra?: { body?: string; emoji?: string },
): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_private_action', {
    p_message_id: messageId,
    p_action: action,
    p_body: extra?.body ?? null,
    p_emoji: extra?.emoji ?? null,
  });
  return error ? fail(error) : { ok: true };
}

/** "Sincronizar contatos": o worker pede a agenda ao WhatsApp e junta os membros dos grupos. */
export async function requestContactsSync(): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_contacts_sync');
  revalidatePath('/private');
  return error ? fail(error) : { ok: true };
}

export async function markPrivateChatRead(chatId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_private_chat_read', { p_chat_id: chatId });
  return error ? fail(error) : { ok: true };
}

/** Assumir, transferir (p_user) ou devolver para "Sem responsável" (null) uma conversa (0114). */
export async function assignPrivateChat(chatId: string, userId: string | null, note = ''): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  // observação para quem recebe (0119); sem o script, a transferência sem observação
  let { error } = await supabase.rpc('assign_private_chat', { p_chat: chatId, p_user: userId, p_note: note || null });
  if (error && /p_note|assign_private_chat/.test(error.message)) {
    ({ error } = await supabase.rpc('assign_private_chat', { p_chat: chatId, p_user: userId }));
  }
  if (error) return fail(error);
  revalidatePath('/private');
  return { ok: true };
}

/** "Marcar como não lida" (0118): a conversa volta a contar como não lida. */
export async function markPrivateChatUnread(chatId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_private_chat_unread', { p_chat_id: chatId });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Finalizar atendimento (0119): a conversa vai para "Finalizados". */
export async function finishPrivateChat(chatId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('finish_private_chat', { p_chat: chatId });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Reabrir um atendimento finalizado, com quem reabriu. */
export async function reopenPrivateChat(chatId: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_private_chat', { p_chat: chatId });
  if (error) return fail(error);
  revalidatePath('/', 'layout');
  return { ok: true };
}
