import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { canSeeMenu, MENU_ITEMS } from '@/lib/menu';
import type { Profile } from '@/lib/types';

/** Usuário logado + perfil ativo. Redireciona caso contrário. */
type CompanyInfo = { id: string; name: string; active: boolean };

/**
 * Perfil + empresa numa consulta só (cada ida ao Supabase custa uma viagem de rede).
 * O token já foi conferido pelo proxy; getClaims aqui valida de novo sem ir ao servidor de login
 * quando o projeto usa chaves assimétricas.
 */
const loadProfile = cache(async (): Promise<{ profile: Profile; company: CompanyInfo | null }> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect('/login');

  const { data } = await supabase.from('profiles').select('*, companies(id, name, active)').eq('id', userId).maybeSingle();
  let row = data as (Profile & { companies?: CompanyInfo | null }) | null;
  if (!row) {
    // usuário criado antes de o banco estar pronto: cria o perfil agora
    const { data: created } = await supabase.rpc('ensure_profile');
    row = created as Profile | null;
  }
  if (!row || !row.active || !row.company_id) redirect('/auth/pending');
  const { companies, ...profile } = row;
  let company = companies ?? null;
  if (!company) {
    const { data: c } = await supabase.from('companies').select('id, name, active').eq('id', row.company_id).maybeSingle();
    company = c;
  }
  // empresa suspensa: ninguém dela entra (quem administra a plataforma continua entrando para dar suporte)
  if (!profile.platform_admin && !company?.active) redirect('/auth/pending?reason=suspended');
  return { profile: profile as Profile, company };
});

/** Usuário logado + perfil ativo. Redireciona caso contrário. */
export const requireProfile = cache(async (): Promise<Profile> => (await loadProfile()).profile);

/** Empresa em que o usuário está agora. */
export const currentCompany = cache(async (): Promise<CompanyInfo | null> => (await loadProfile()).company);

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

/** Configuração dos menus da empresa (Configurações › Menus). */
export const menuConfig = cache(async (): Promise<Record<string, unknown>> => {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('menu_access').maybeSingle();
  return (data?.menu_access as Record<string, unknown> | null) ?? {};
});

/**
 * Página de um item do menu: se o menu está oculto para este usuário, vai para o primeiro menu
 * liberado (o endereço digitado direto não fura a configuração).
 */
export async function requireMenu(href: string): Promise<Profile> {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const viewer = profile.role === 'viewer';
  const agendaOnly = profile.role === 'agenda';
  const config = await menuConfig();
  if (!canSeeMenu(config, href, isAdmin, viewer, agendaOnly)) {
    const first = MENU_ITEMS.find((i) => canSeeMenu(config, i.href, isAdmin, viewer, agendaOnly));
    redirect(first ? first.href : '/auth/pending');
  }
  return profile;
}
