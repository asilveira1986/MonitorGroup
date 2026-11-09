import type { NextRequest } from 'next/server';
import { requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 60 * 60;

/**
 * Abre uma figurinha da biblioteca da empresa (0160). O bucket é privado: a figurinha é lida com a sessão do
 * usuário (só a da própria empresa) e, se ele pode vê-la, recebe um link temporário do Storage.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: sticker } = await supabase.from('stickers').select('media_path').eq('id', id).maybeSingle();
  if (!sticker?.media_path) return new Response('Figurinha não encontrada', { status: 404 });
  const { data, error } = await createAdminClient().storage.from('media').createSignedUrl(sticker.media_path as string, LINK_SECONDS);
  if (error || !data?.signedUrl) return new Response('Figurinha indisponível', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, 'cache-control': `private, max-age=${LINK_SECONDS - 300}` },
  });
}
