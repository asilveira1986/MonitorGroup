import { isAcknowledgement } from './acknowledgement.js';
import { isInformational } from './informational.js';

/**
 * A mensagem do cliente numa conversa privada pede resposta da equipe? Não pede: agradecimento/confirmação ("ok",
 * "obrigado", "bom dia", 👍, figurinha), informe ("sem novidades, aviso aqui") e o cliente dizendo que vai ver/verificar
 * ("vou verificar"). Mesmo critério das mensagens de grupo, respeitando a opção "ignorar agradecimentos".
 */
export function opensPendingPrivate(
  type: string,
  body: string | null | undefined,
  settings: { ignore_acknowledgements?: boolean | null; ignore_phrases?: string[] | null },
): boolean {
  if (settings.ignore_acknowledgements === false) return true;
  return !(isAcknowledgement(type, body ?? null, settings.ignore_phrases) || isInformational(type, body));
}
