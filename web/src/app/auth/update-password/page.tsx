import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UpdatePasswordForm } from './update-password-form';

/**
 * Definir a senha: no primeiro acesso (senha inicial ou gerada pelo administrador, 0123) e ao voltar
 * do link de "Esqueci minha senha".
 */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect('/login');
  const { data } = await supabase.from('profiles').select('must_change_password').eq('id', userId).maybeSingle();
  return <UpdatePasswordForm firstAccess={!!data?.must_change_password} />;
}
