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
  if (!profile || !profile.active || !profile.company_id) redirect('/auth/pending');
  // empresa suspensa: ninguém dela entra (quem administra a plataforma continua entrando para dar suporte)
  if (!profile.platform_admin) {
    const { data: company } = await supabase.from('companies').select('active').eq('id', profile.company_id).maybeSingle();
    if (!company?.active) redirect('/auth/pending?reason=suspended');
  }
  return profile as Profile;
});

/** Empresa em que o usuário está agora. */
export const currentCompany = cache(async (): Promise<{ id: string; name: string; active: boolean } | null> => {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from('companies').select('id, name, active').eq('id', profile.company_id!).maybeSingle();
  return data;
});

/** Só quem administra a plataforma (tela Empresas). */
export async function requirePlatformAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (!profile.platform_admin) redirect('/dashboard');
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== 'admin' && !profile.platform_admin) redirect('/dashboard');
  return profile;
}
