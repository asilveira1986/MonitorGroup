import { requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 24 * 60 * 60;

/** Foto do atendente (cadastro, 0083): só de quem é da empresa do usuário (RLS de team_members). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await ctx.params;
  const { data } = await (await createClient()).from('team_members').select('photo_path').eq('id', id).maybeSingle();
  const path = (data as { photo_path?: string | null } | null)?.photo_path;
  if (!path) return new Response('Sem foto', { status: 404 });
  const { data: link } = await createAdminClient().storage.from('media').createSignedUrl(path, LINK_SECONDS);
  if (!link?.signedUrl) return new Response('Sem foto', { status: 404 });
  return new Response(null, { status: 302, headers: { location: link.signedUrl, 'cache-control': 'private, max-age=3600' } });
}
