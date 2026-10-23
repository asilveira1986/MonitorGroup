import { currentCompany, requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 24 * 60 * 60;

/** Logo da empresa em que o usuário está (Configurações › Empresa, 0083), por link temporário. */
export async function GET() {
  await requireProfile();
  const company = await currentCompany();
  if (!company) return new Response('Sem logo', { status: 404 });
  const { data } = await (await createClient()).from('companies').select('logo_path').eq('id', company.id).maybeSingle();
  const path = (data as { logo_path?: string | null } | null)?.logo_path;
  if (!path) return new Response('Sem logo', { status: 404 });
  const { data: link } = await createAdminClient().storage.from('media').createSignedUrl(path, LINK_SECONDS);
  if (!link?.signedUrl) return new Response('Sem logo', { status: 404 });
  return new Response(null, { status: 302, headers: { location: link.signedUrl, 'cache-control': 'private, max-age=3600' } });
}
