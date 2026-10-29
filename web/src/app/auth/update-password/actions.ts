'use server';

import { createClient } from '@/lib/supabase/server';

/** Troca a senha de quem está logado e limpa a marca de primeiro acesso (0123). */
export async function changeOwnPassword(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (password.length < 8) return { ok: false, error: 'A senha precisa de ao menos 8 caracteres.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') return { ok: false, error: 'Escolha uma senha diferente da atual.' };
    if (error.code === 'weak_password') return { ok: false, error: 'Senha fraca: use letras e números, com ao menos 8 caracteres.' };
    return { ok: false, error: error.message };
  }
  const { error: flagError } = await supabase.rpc('password_changed');
  if (flagError) return { ok: false, error: flagError.message };
  return { ok: true };
}
