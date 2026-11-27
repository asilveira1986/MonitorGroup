/**
 * Mensagens privadas que o WhatsApp recusa depois de aceitar o envio.
 *
 * `sendMessage` volta sem erro assim que a mensagem sai pela conexão; a recusa chega depois, num aviso do servidor com um código
 * de erro (status 0 = ERRO). Antes ela era gravada e não aparecia em lugar nenhum: a mensagem ficava no painel como enviada e o
 * cliente nunca recebia. Agora o worker reenvia (com o mesmo id, então o cliente nunca recebe duas vezes) e, se não adiantar,
 * marca a mensagem como não entregue.
 */

/** Status "erro" do WhatsApp (gravado em private_messages.wa_status). */
export const ERROR_STATUS = 0;

/** Quantas vezes o worker reenvia uma mensagem recusada antes de desistir. */
export const MAX_SEND_RETRIES = 2;

/**
 * Recusas em que reenviar não adianta ou piora: 463 (conta com restrição / sem permissão de iniciar conversa; cada novo envio
 * conta como outra tentativa) e erros de formato da própria mensagem (487 a 495).
 */
const NO_RETRY_CODES = new Set(['463', '487', '488', '489', '490', '491', '493', '495']);

/** Código de erro do aviso de recusa do WhatsApp (o primeiro parâmetro do aviso), se houver. */
export function ackErrorCode(update: { messageStubParameters?: unknown }): string | null {
  const params = update.messageStubParameters;
  return Array.isArray(params) && params.length > 0 && params[0] != null ? String(params[0]) : null;
}

/** Vale reenviar? Sim, até MAX_SEND_RETRIES vezes, exceto nas recusas que o reenvio não resolve. */
export function shouldRetrySend(code: string | null, attempts: number): boolean {
  return attempts < MAX_SEND_RETRIES && !(code !== null && NO_RETRY_CODES.has(code));
}

/** Espera antes de cada reenvio (cresce a cada tentativa). */
export function retryDelayMs(attempt: number): number {
  return 3_000 * Math.max(1, attempt);
}
