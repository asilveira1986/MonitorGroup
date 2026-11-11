import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Retorno do link de recuperação de senha. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/panel';

  // O Supabase devolve o motivo quando o link é recusado
  let reason = searchParams.get('error_description') ?? searchParams.get('error');

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
    reason = error.message;
  } else if (tokenHash && type === 'recovery') {
    // modelo de e-mail com {{ .TokenHash }}: não depende de abrir no mesmo navegador em que a pessoa pediu
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${safeNext === '/panel' ? '/auth/update-password' : safeNext}`);
    reason = error.message;
  } else if (!reason) {
    reason = 'O retorno do login veio sem código de autorização.';
  }

  const url = new URL('/login', origin);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}
