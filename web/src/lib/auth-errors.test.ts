import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainAuthError, strayAuthRedirect } from './auth-errors.ts';

test('mensagens do Supabase em português, com o que fazer', () => {
  assert.equal(explainAuthError('Invalid login credentials'), 'E-mail ou senha incorretos.');
  assert.match(explainAuthError('Email link is invalid or has expired'), /venceu ou já foi aberto/);
  assert.match(explainAuthError('otp_expired'), /venceu ou já foi aberto/);
  assert.match(explainAuthError('PKCE code verifier not found in storage'), /mesmo navegador/);
  assert.match(explainAuthError('Email address not authorized'), /SMTP próprio/);
  assert.match(explainAuthError('Error sending recovery email'), /não conseguiu enviar o e-mail/);
  assert.match(explainAuthError('email rate limit exceeded'), /Muitos e-mails/);
  assert.match(explainAuthError('For security purposes, you can only request this after 20 seconds.'), /Muitos e-mails/);
  assert.equal(explainAuthError('algo desconhecido'), 'algo desconhecido');
});

test('código do link que caiu na página inicial ou no login vai para o retorno da recuperação', () => {
  assert.equal(strayAuthRedirect(new URL('https://app.x/?code=abc123')), '/auth/callback?code=abc123&next=%2Fauth%2Fupdate-password');
  assert.equal(strayAuthRedirect(new URL('https://app.x/login?code=abc123')), '/auth/callback?code=abc123&next=%2Fauth%2Fupdate-password');
});

test('erro do link que caiu na página inicial vai para o login com o motivo', () => {
  const to = strayAuthRedirect(new URL('https://app.x/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'));
  assert.equal(to, '/login?error=Email+link+is+invalid+or+has+expired');
  assert.equal(strayAuthRedirect(new URL('https://app.x/?error_code=otp_expired')), '/login?error=otp_expired');
});

test('o resto não é mexido', () => {
  assert.equal(strayAuthRedirect(new URL('https://app.x/')), null);
  assert.equal(strayAuthRedirect(new URL('https://app.x/login')), null);
  assert.equal(strayAuthRedirect(new URL('https://app.x/login?error=auth')), null);
  assert.equal(strayAuthRedirect(new URL('https://app.x/panel?code=1')), null);
  assert.equal(strayAuthRedirect(new URL('https://app.x/auth/callback?code=1')), null);
});
