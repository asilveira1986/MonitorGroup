import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Classificação de demandas por IA (Claude). Só roda quando a opção
 * "Classificação automática por IA" está ligada e ANTHROPIC_API_KEY existe.
 */
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client: Anthropic | null = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  return client;
};

export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

const Result = z.object({
  is_demand: z.boolean(),
  category: z.string(),
  summary: z.string(),
});
export type DemandClassification = z.infer<typeof Result>;

const SYSTEM = `Você analisa mensagens que clientes enviam em grupos de WhatsApp de atendimento de uma empresa.
Decida se a mensagem é uma DEMANDA: um pedido concreto que exige uma entrega ou ação da equipe
(ex.: enviar documento, corrigir um erro, fazer um orçamento, emitir boleto, agendar algo).
Não são demandas: cumprimentos, agradecimentos, confirmações, conversas sociais, perguntas que se
resolvem só com uma resposta curta, e mensagens sem contexto suficiente.
Se for demanda, escolha a categoria mais adequada da lista fornecida e escreva um resumo curto
(até 12 palavras, em português, no imperativo, ex.: "Emitir segunda via do boleto de outubro").
Se não for demanda, use is_demand=false, category="" e summary="".`;

export async function classifyDemand(text: string, categories: string[]): Promise<DemandClassification | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(Result) },
      messages: [
        {
          role: 'user',
          content: `Categorias possíveis: ${categories.join(', ')}\n\nMensagem do cliente:\n<mensagem>\n${text.slice(0, 2000)}\n</mensagem>`,
        },
      ],
    });
    // recusa ou resposta incompleta: trata como "não é demanda"
    if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
    const out = response.parsed_output;
    if (out.is_demand && !categories.includes(out.category)) out.category = '';
    return out;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) logger.warn('IA: limite de requisições atingido');
    else if (err instanceof Anthropic.AuthenticationError) logger.error('IA: ANTHROPIC_API_KEY inválida');
    else if (err instanceof Anthropic.APIError) logger.error({ status: err.status, message: err.message }, 'IA: erro na API');
    else logger.error({ err }, 'IA: falha na classificação');
    return null;
  }
}
