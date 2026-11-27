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

const TYPE_LABEL: Record<string, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  contact: 'Contato',
};

/** Alerta em tela de uma mensagem privada que não foi entregue: título, descrição e quem recebe (quem escreveu e o responsável). */
export function privateFailureAlert(input: {
  contactName: string | null;
  phone: string | null;
  body: string | null;
  messageType: string;
  code: string | null;
  retries: number;
  sender: string | null;
  responsible: string | null;
}): { title: string; description: string; userIds: string[] } {
  const who = input.contactName?.trim() || (input.phone ? `+${input.phone}` : 'o contato');
  const text = input.body?.trim() ? `"${input.body.trim().slice(0, 120)}${input.body.trim().length > 120 ? '…' : ''}"` : (TYPE_LABEL[input.messageType] ?? 'A mensagem');
  const tries = input.retries > 0 ? ` mesmo depois de ${input.retries} ${input.retries === 1 ? 'reenvio automático' : 'reenvios automáticos'}` : '';
  const reason = input.code ? ` (código ${input.code})` : '';
  return {
    title: `Mensagem não entregue a ${who}`,
    description: `${text} não chegou ao cliente: o WhatsApp recusou o envio${tries}${reason}. Abra a conversa e envie de novo.`,
    // quem escreveu e o responsável pela conversa (sem repetir; vazio = só ninguém vê, nunca todos)
    userIds: [...new Set([input.sender, input.responsible].filter((id): id is string => Boolean(id)))],
  };
}
