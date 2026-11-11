/** Mensagens do login e da recuperação de senha (Supabase) explicadas em português, dizendo o que fazer. */

export function explainAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed'))
    return 'E-mail ainda não confirmado. No Supabase, abra Authentication › Users, clique no usuário e confirme o e-mail (ou recrie com "Auto confirm user").';
  if (m.includes('invalid api key') || m.includes('no api key'))
    return 'Chave do Supabase inválida. Confira NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e faça um novo deploy.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed'))
    return 'Não foi possível conectar ao Supabase. Confira NEXT_PUBLIC_SUPABASE_URL na Vercel e se o projeto do Supabase está ativo (projetos gratuitos pausam após 7 dias sem uso).';
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'Cadastro de novos usuários desativado no Supabase. Ative "Allow new users to sign up" em Authentication › Sign In / Providers.';
  if (m.includes('database error saving new user'))
    return 'Erro no banco ao criar o usuário. Verifique se os scripts SQL (0001 a 0004) foram executados no Supabase.';
  // o e-mail padrão do Supabase só envia para membros da equipe do projeto: com outro destinatário, recusa
  if (m.includes('not authorized') && m.includes('email'))
    return 'O envio de e-mails do Supabase não está liberado para este endereço (o envio padrão só vale para a equipe do projeto). Configure um SMTP próprio em Authentication › Emails › SMTP Settings, ou peça a um administrador para gerar uma nova senha em Configurações › Usuários.';
  if (m.includes('error sending') || m.includes('sending recovery email') || m.includes('smtp'))
    return 'O Supabase não conseguiu enviar o e-mail. Confira o SMTP em Authentication › Emails › SMTP Settings, ou peça a um administrador para gerar uma nova senha em Configurações › Usuários.';
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('security purposes'))
    return 'Muitos e-mails enviados em pouco tempo. Aguarde cerca de 1 hora e tente de novo, ou peça a um administrador para gerar uma nova senha em Configurações › Usuários.';
  // link de recuperação vencido ou já aberto (programas de segurança do e-mail costumam abrir o link antes da pessoa)
  if (m.includes('otp_expired') || m.includes('expired') || m.includes('invalid or has') || m.includes('token has') || m.includes('already been used'))
    return 'O link de redefinição venceu ou já foi aberto (vale por 1 hora e uma vez só). Peça um novo em "Esqueci minha senha" e abra o link logo, no mesmo navegador em que pediu.';
  if (m.includes('code verifier') || m.includes('pkce') || m.includes('flow state'))
    return 'O link precisa ser aberto no mesmo navegador (e aparelho) em que você pediu a redefinição. Peça um novo link em "Esqueci minha senha" e abra-o nesse mesmo navegador.';
  if (m.includes('redirect'))
    return 'Falha no retorno do login. No Supabase, em Authentication › URL Configuration, coloque o endereço do painel em Site URL e em Redirect URLs (com /** no final). Abra o login sempre pelo mesmo endereço.';
  return message;
}

/**
 * O Supabase às vezes devolve o código (ou o erro) do link de recuperação na página inicial ou no login, em vez de em
 * /auth/callback (quando o endereço do painel não está em Redirect URLs). Devolve para onde levar, ou null.
 */
export function strayAuthRedirect(url: URL): string | null {
  const path = url.pathname;
  if (path !== '/' && path !== '/login') return null;
  const code = url.searchParams.get('code');
  if (code) {
    // neste sistema o único retorno com código é o da recuperação de senha
    const to = new URL('/auth/callback', url.origin);
    to.searchParams.set('code', code);
    to.searchParams.set('next', '/auth/update-password');
    return `${to.pathname}${to.search}`;
  }
  const description = url.searchParams.get('error_description');
  const err = url.searchParams.get('error_code') ?? url.searchParams.get('error');
  if (path === '/' && (description || (err && err !== 'auth'))) {
    const to = new URL('/login', url.origin);
    to.searchParams.set('error', description ?? err ?? 'auth');
    return `${to.pathname}${to.search}`;
  }
  return null;
}
