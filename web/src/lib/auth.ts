import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

/** Usuário logado + perfil ativo. Redireciona caso contrário. */
export const requireProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile) {
    // usuário criado antes de o banco estar pronto: cria o perfil agora
    const { data } = await supabase.rpc('ensure_profile');
    profile = data;
  }
  if (!profile || !profile.active) redirect('/auth/pending');
  return profile as Profile;
});

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== 'admin') redirect('/dashboard');
  return profile;
}
