import type { NextRequest } from 'next/server';
import { requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 60 * 60;

/**
 * Abre o arquivo de uma mensagem das conversas privadas (0070). A mensagem é lida com a sessão do
 * usuário (só quem administra a plataforma, com o módulo ligado) e, se ele pode vê-la, recebe um
 * link temporário do Storage. ?download=1 baixa com o nome do arquivo.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: message } = await supabase
    .from('private_messages')
    .select('id, media_path, body, message_type')
    .eq('id', id)
    .maybeSingle();
  if (!message?.media_path) return new Response('Arquivo não encontrado', { status: 404 });

  const download = request.nextUrl.searchParams.has('download');
  const ext = message.media_path.split('.').pop();
  const name = message.message_type === 'document' && message.body ? message.body : `${message.message_type}-${id.slice(0, 8)}.${ext}`;
  const { data, error } = await createAdminClient()
    .storage.from('media')
    .createSignedUrl(message.media_path, LINK_SECONDS, download ? { download: name } : undefined);
  if (error || !data?.signedUrl) return new Response('Arquivo indisponível', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, 'cache-control': `private, max-age=${LINK_SECONDS - 300}` },
  });
}
