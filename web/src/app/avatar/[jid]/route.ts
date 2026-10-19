import { requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 24 * 60 * 60;

/**
 * Foto de perfil de um contato ou grupo (guardada pelo worker no bucket privado). Só entrega se o
 * usuário vê esse grupo ou um grupo de que o contato participa (mesmas regras de acesso da conversa).
 */
export async function GET(request: Request, ctx: { params: Promise<{ jid: string }> }) {
  await requireProfile();
  const jid = decodeURIComponent((await ctx.params).jid);
  const supabase = await createClient();

  // ?tamanho=grande: versão para ampliar (sem ela, a pequena)
  const full = new URL(request.url).searchParams.get('tamanho') === 'grande';
  const { data: avatar } = await supabase.from('contact_avatars').select('*').eq('jid', jid).maybeSingle();
  const row = avatar as { path: string | null; full_path?: string | null } | null;
  const path = (full && row?.full_path) || row?.path;
  if (!path) return new Response('Sem foto', { status: 404 });

  const visible = jid.endsWith('@g.us')
    ? await supabase.from('groups').select('id').eq('jid', jid).limit(1)
    : await supabase.from('group_participants').select('group_id').eq('jid', jid).limit(1);
  if (!visible.data?.length) return new Response('Sem foto', { status: 404 });

  const { data, error } = await createAdminClient().storage.from('media').createSignedUrl(path, LINK_SECONDS);
  if (error || !data?.signedUrl) return new Response('Sem foto', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, 'cache-control': 'private, max-age=21600' },
  });
}
