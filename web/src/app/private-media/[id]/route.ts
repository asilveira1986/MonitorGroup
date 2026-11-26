import type { NextRequest } from 'next/server';
import { requireProfile } from '@/lib/auth';
import { downloadName } from '@/lib/download-name';
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
  // documento: o texto da mensagem com a extensão do arquivo (a legenda sozinha baixava sem o ".pdf")
  const name = downloadName({ type: message.message_type, body: message.body, id, path: message.media_path });
  const { data, error } = await createAdminClient()
    .storage.from('media')
    .createSignedUrl(message.media_path, LINK_SECONDS, download ? { download: name } : undefined);
  if (error || !data?.signedUrl) return new Response('Arquivo indisponível', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, 'cache-control': `private, max-age=${LINK_SECONDS - 300}` },
  });
}
