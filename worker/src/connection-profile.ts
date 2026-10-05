import type { AuthenticationCreds } from 'baileys';

export type ConnectionProfile = 'desktop' | 'chrome';
/** perfil de conexão usado no pareamento, guardado junto da sessão (reconexões usam o mesmo) */
export type MonitorCreds = AuthenticationCreds & { monitorProfile?: ConnectionProfile };

/**
 * Sessão já pareada? No pareamento por QR code a biblioteca preenche `me`;
 * `registered` só é marcado no pareamento por código.
 */
export const isPaired = (creds: Pick<AuthenticationCreds, 'me' | 'registered'>) =>
  Boolean(creds.me?.id) || Boolean(creds.registered);

/**
 * Perfil da conexão:
 *  - sessão pareada: sempre o perfil usado no pareamento (trocar faz o WhatsApp derrubar a conexão);
 *  - pareamento novo: o preferido (Desktop, se a importação de histórico estiver ligada) e,
 *    a cada falha, alterna com o Chrome, que o WhatsApp aceita em mais ambientes.
 */
export function chooseProfile(opts: {
  paired: boolean;
  savedProfile: ConnectionProfile | undefined;
  wantsHistory: boolean;
  failedAttempts: number;
}): ConnectionProfile {
  const preferred: ConnectionProfile = opts.wantsHistory ? 'desktop' : 'chrome';
  if (opts.paired) return opts.savedProfile ?? preferred;
  return opts.failedAttempts % 2 === 1 ? 'chrome' : preferred;
}
