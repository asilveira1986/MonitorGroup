import { requireProfile } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const LINK_SECONDS = 24 * 60 * 60;

/**
 * Foto de perfil de um contato ou grupo (guardada pelo worker no bucket privado). Só entrega se o
 * usuário vê esse grupo ou um grupo de que o contato participa (mesmas regras de acesso da conversa),
 * ou, com as conversas privadas liberadas, se o contato está na agenda ou numa conversa (0113).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ jid: string }> }) {
  await requireProfile();
  const jid = decodeURIComponent((await ctx.params).jid);
  const supabase = await createClient();

  const { data: avatar } = await supabase.from('contact_avatars').select('path').eq('jid', jid).maybeSingle();
  if (!avatar?.path) return new Response('Sem foto', { status: 404 });

  const visible = jid.endsWith('@g.us')
    ? await supabase.from('groups').select('id').eq('jid', jid).limit(1)
    : await supabase.from('group_participants').select('group_id').eq('jid', jid).limit(1);
  // agenda do WhatsApp e conversas privadas: as tabelas só mostram as linhas a quem pode usá-las
  const contact =
    visible.data?.length || jid.endsWith('@g.us')
      ? null
      : (await supabase.from('wa_contacts').select('jid').eq('jid', jid).limit(1)).data?.length ||
        (await supabase.from('private_chats').select('id').eq('jid', jid).limit(1)).data?.length;
  if (!visible.data?.length && !contact) return new Response('Sem foto', { status: 404 });

  const { data, error } = await createAdminClient().storage.from('media').createSignedUrl(avatar.path, LINK_SECONDS);
  if (error || !data?.signedUrl) return new Response('Sem foto', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, 'cache-control': 'private, max-age=21600' },
  });
}
