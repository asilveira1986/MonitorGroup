'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { dbResult as result, type ActionResult as Result } from '@/lib/action-result';
import { normalizeShortcut, type QuickReply } from '@/lib/quick-replies';
import { reapplyIgnoreRules, type ReapplySummary } from '@/lib/reapply-ignore';
import { createClient } from '@/lib/supabase/server';

/** Mensagens a ignorar: agradecimentos, figurinha/emoji e frases da empresa. */
export async function saveIgnoreSettings(values: {
  acknowledgements: boolean;
  stickers: boolean;
  phrases: string[];
  /** reação da equipe conta como resposta (0111) */
  reactions?: boolean;
}): Promise<Result & { summary?: ReapplySummary }> {
  const profile = await requireAdmin();
  const phrases = [...new Set(values.phrases.map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean))]
    .map((p) => p.slice(0, 120))
    .slice(0, 200);
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      ignore_acknowledgements: values.acknowledgements,
      ignore_stickers_emoji: values.stickers,
      ignore_phrases: phrases,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  if (error) return result(error);
  // à parte: sem o script 0111 a coluna não existe e o resto salva normal
  if (values.reactions !== undefined) {
    await supabase.from('app_settings').update({ reaction_answers: values.reactions }).eq('company_id', profile.company_id);
  }
  // as mensagens já recebidas passam pelas mesmas regras
  let summary: ReapplySummary | undefined;
  try {
    if (profile.company_id) summary = await reapplyIgnoreRules(profile.company_id, {
      acknowledgements: values.acknowledgements,
      stickers: values.stickers,
      phrases,
    });
  } catch (err) {
    revalidatePath('/', 'layout');
    return { ok: false, error: `Regras salvas, mas não foi possível atualizar as mensagens já recebidas: ${(err as Error).message}` };
  }
  revalidatePath('/', 'layout');
  return { ok: true, summary };
}

export async function saveQuickReply(values: {
  id: string | null;
  shortcut: string;
  title: string;
  body: string;
}): Promise<Result & { item?: QuickReply }> {
  await requireAdmin();
  const shortcut = normalizeShortcut(values.shortcut);
  const body = values.body.trim();
  if (!shortcut) return { ok: false, error: 'Informe o atalho (letras, números, - ou _).' };
  if (!body) return { ok: false, error: 'Escreva o texto da mensagem.' };
  const row = { shortcut, title: values.title.trim() || null, body: body.slice(0, 4000), updated_at: new Date().toISOString() };
  const supabase = await createClient();
  const query = values.id
    ? supabase.from('quick_replies').update(row).eq('id', values.id)
    : supabase.from('quick_replies').insert(row);
  const { data, error } = await query.select('id, shortcut, title, body').single();
  if (error?.code === '23505') return { ok: false, error: `Já existe uma mensagem rápida com o atalho \\${shortcut}.` };
  if (error) return result(error);
  revalidatePath('/settings/quick-replies');
  revalidatePath('/groups', 'layout');
  return { ok: true, item: data as QuickReply };
}

/** Qual mensagem rápida encerra a conversa (padrão \fechamento). */
export async function saveClosingShortcut(shortcut: string): Promise<Result> {
  const profile = await requireAdmin();
  const value = normalizeShortcut(shortcut);
  if (!value) return { ok: false, error: 'Escolha a mensagem rápida de fechamento.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ closing_shortcut: value, updated_at: new Date().toISOString() })
    .eq('company_id', profile.company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

export async function deleteQuickReply(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from('quick_replies').delete().eq('id', id);
  revalidatePath('/settings/quick-replies');
  return result(error);
}

export async function saveReplySettings(values: {
  enabled: boolean;
  signName: boolean;
  allowed: 'all' | 'admin';
  /** assinatura no privado (0116) */
  signPrivate?: boolean;
}): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      reply_enabled: values.enabled,
      reply_sign_name: values.signName,
      reply_allowed: values.allowed === 'admin' ? 'admin' : 'all',
      ...(values.signPrivate === undefined ? {} : { private_sign_name: values.signPrivate }),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', (await requireAdmin()).company_id);
  revalidatePath('/', 'layout');
  return result(error);
}

/** Pendência da conversa por regras (0167): liga/desliga e as frases de pedido ao cliente e de entrega (vazio = padrão). */
export async function saveFollowupSettings(values: { enabled: boolean; requestPhrases: string[]; deliveryPhrases: string[] }): Promise<Result> {
  const profile = await requireAdmin();
  const clean = (list: string[]) => {
    const out = [...new Set(list.map((p) => p.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))].map((p) => p.slice(0, 80)).slice(0, 300);
    return out.length ? out : null;
  };
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      followup_enabled: values.enabled,
      followup_request_phrases: clean(values.requestPhrases),
      followup_delivery_phrases: clean(values.deliveryPhrases),
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id);
  if (error) return result(error);
  // regras novas: o worker recalcula a pendência dos grupos aos poucos
  await supabase.rpc('recompute_followups');
  revalidatePath('/', 'layout');
  return { ok: true };
}
