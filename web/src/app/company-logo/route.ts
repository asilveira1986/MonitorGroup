import type { NextRequest } from 'next/server';
import { currentCompany, requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 24 * 60 * 60;

/**
 * Logo da empresa em que o usuário está (Configurações › Empresa, 0083), por link temporário.
 * Quem administra a plataforma pede o de outra empresa com ?id= (lista de troca de empresa).
 */
export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  const company = await currentCompany();
  const other = request.nextUrl.searchParams.get('id');
  const id = other && profile.platform_admin && /^[0-9a-f-]{36}$/i.test(other) ? other : company?.id;
  if (!id) return new Response('Sem logo', { status: 404 });
  const client = id === company?.id ? await createClient() : createAdminClient();
  const { data } = await client.from('companies').select('logo_path').eq('id', id).maybeSingle();
  const path = (data as { logo_path?: string | null } | null)?.logo_path;
  if (!path) return new Response('Sem logo', { status: 404 });
  const { data: link } = await createAdminClient().storage.from('media').createSignedUrl(path, LINK_SECONDS);
  if (!link?.signedUrl) return new Response('Sem logo', { status: 404 });
  return new Response(null, { status: 302, headers: { location: link.signedUrl, 'cache-control': 'private, max-age=3600' } });
}
