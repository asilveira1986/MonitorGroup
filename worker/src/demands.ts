import { aiAvailable, classifyDemand } from './ai.js';
import { onRework } from './alerts.js';
import { getSettings } from './cache.js';
import { parsePromise } from './dates.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { findKeyword } from './text.js';

/**
 * Detecta demandas e seus eventos nas mensagens dos grupos:
 *  - comandos (#demanda, #andamento, #entregue, #cancelada, #prazo, #confirmada)
 *  - palavra-chave do cliente que abre demanda
 *  - cobrança, reabertura e confirmação do cliente
 *  - prazo prometido pela equipe ("até sexta", "até 15/10")
 *  - classificação por IA (opcional)
 * Os eventos são gravados mesmo com os indicadores desligados: ao religar, o histórico está completo.
 */

export type DemandMessage = {
  groupId: string;
  groupName: string;
  messageId: string;
  /** id da mensagem citada (resposta a uma mensagem), se houver */
  quotedWaId: string | null;
  body: string | null;
  messageType: string;
  fromTeam: boolean;
  senderName: string | null;
  teamMemberId: string | null;
  opensPending: boolean;
};

type Demand = {
  id: string;
  number: number;
  status: string;
  promised_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  followups_count: number;
};

// ordem importa: a primeira categoria que casar vence (a mais genérica fica por último)
export const DEFAULT_CATEGORIES = [
  { name: 'Financeiro', keywords: ['boleto', 'nota fiscal', 'pagamento', 'fatura', 'cobrança', 'pix', 'reembolso'] },
  { name: 'Erro', keywords: ['erro', 'não funciona', 'bug', 'travou', 'problema', 'parou', 'falha'] },
  { name: 'Dúvida', keywords: ['dúvida', 'como faço', 'como funciona', 'pergunta', 'saber se'] },
  { name: 'Pedido novo', keywords: ['solicito', 'preciso de', 'gostaria', 'orçamento', 'pedido', 'novo'] },
];

/** Remove do fim da descrição o prazo já reconhecido ("... até sexta"). */
const stripPromise = (text: string) =>
  text.replace(/\s+(até|ate|prazo:?|em \d+ ?(?:dias?|horas?|h|min))(?=\s|$).*$/iu, '').trim();

type Params = {
  followup_keywords: string[];
  reopen_keywords: string[];
  followups_threshold: number;
  confirm_keywords: string[];
  confirm_window_days: number;
  categories: { name: string; keywords: string[] }[];
};

let paramsCache: { at: number; value: Params } | null = null;

/** Parâmetros lidos do catálogo (cache de 60s). */
async function loadParams(): Promise<Params> {
  if (paramsCache && Date.now() - paramsCache.at < 60_000) return paramsCache.value;
  const { data } = await db
    .from('indicators')
    .select('key, params')
    .in('key', ['retrabalho', 'confirmacao_cliente', 'tipo_demanda']);
  const byKey = Object.fromEntries((data ?? []).map((r) => [r.key, (r.params ?? {}) as Record<string, unknown>]));
  const value: Params = {
    followup_keywords: (byKey.retrabalho?.followup_keywords as string[]) ?? [],
    reopen_keywords: (byKey.retrabalho?.reopen_keywords as string[]) ?? [],
    followups_threshold: Number(byKey.retrabalho?.followups_threshold ?? 2),
    confirm_keywords: (byKey.confirmacao_cliente?.confirm_keywords as string[]) ?? [],
    confirm_window_days: Number(byKey.confirmacao_cliente?.confirm_window_days ?? 7),
    categories: (byKey.tipo_demanda?.categories as Params['categories']) ?? DEFAULT_CATEGORIES,
  };
  paramsCache = { at: Date.now(), value };
  return value;
}

export function classifyCategory(text: string | null, categories: Params['categories']): string | null {
  for (const c of categories) if (findKeyword(text, c.keywords)) return c.name;
  return null;
}

const COMMAND = /#(demanda|andamento|entregue|cancelada?|prazo|confirmada?)\b\s*(.*)/i;

async function latestDemand(groupId: string, statuses: string[]): Promise<Demand | null> {
  const { data } = await db
    .from('demands')
    .select('id, number, status, promised_at, delivered_at, confirmed_at, followups_count')
    .eq('group_id', groupId)
    .in('status', statuses)
    .order(statuses.includes('entregue') ? 'delivered_at' : 'opened_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as Demand | null) ?? null;
}

async function quotedMessage(groupId: string, quotedWaId: string | null) {
  if (!quotedWaId) return null;
  const { data } = await db
    .from('messages')
    .select('id, body, demand_id')
    .eq('group_id', groupId)
    .eq('wa_message_id', quotedWaId)
    .maybeSingle();
  return data as { id: string; body: string | null; demand_id: string | null } | null;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) logger.warn({ name, error: error.message }, 'demanda: operação recusada');
  return error ? null : data;
}

export async function processDemandSignals(m: DemandMessage) {
  try {
    const settings = await getSettings();
    const params = await loadParams();
    const actor = `WhatsApp · ${m.senderName ?? (m.fromTeam ? 'Equipe' : 'Cliente')}`;
    const promiseOpts = { timeZone: settings.timezone, businessEnd: settings.business_end.slice(0, 5) };

    // 1) comandos
    const cmd = settings.demand_command_enabled && m.body ? COMMAND.exec(m.body) : null;
    if (cmd) {
      const action = cmd[1].toLowerCase();
      const rest = cmd[2].trim();
      const quoted = await quotedMessage(m.groupId, m.quotedWaId);

      if (action === 'demanda') {
        const origin = quoted ?? { id: m.messageId, body: m.body };
        const description =
          stripPromise(rest) || (quoted?.body ?? '') || (m.body ?? '').replace(COMMAND, '').trim() || 'Demanda sem descrição';
        await rpc('create_demand', {
          p_group_id: m.groupId,
          p_description: description,
          p_message_id: origin.id,
          p_type: classifyCategory(`${description} ${origin.body ?? ''}`, params.categories),
          p_assignee_id: m.fromTeam ? m.teamMemberId : null,
          p_promised_at: parsePromise(rest, new Date(), promiseOpts)?.toISOString() ?? null,
          p_source: 'keyword',
          p_actor: actor,
        });
        return;
      }

      const target =
        (quoted?.demand_id ? { id: quoted.demand_id } : null) ??
        (action.startsWith('confirmada')
          ? await latestDemand(m.groupId, ['entregue'])
          : await latestDemand(m.groupId, ['aberta', 'em_andamento']));
      if (!target) return;

      const changes: Record<string, unknown> =
        action === 'andamento'
          ? { status: 'em_andamento' }
          : action === 'entregue'
            ? { status: 'entregue' }
            : action.startsWith('cancelada')
              ? { status: 'cancelada' }
              : action.startsWith('confirmada')
                ? { confirmed: true }
                : (() => {
                    const when = parsePromise(`até ${rest}`, new Date(), promiseOpts);
                    return when ? { promised_at: when.toISOString() } : {};
                  })();
      if (Object.keys(changes).length) {
        await rpc('update_demand', { p_id: target.id, p_changes: changes, p_message_id: m.messageId, p_actor: actor });
      }
      return;
    }

    // 2) equipe informando prazo para a demanda em aberto mais recente
    if (m.fromTeam) {
      const when = parsePromise(m.body, new Date(), promiseOpts);
      if (!when) return;
      const open = await latestDemand(m.groupId, ['aberta', 'em_andamento']);
      if (open && !open.promised_at) {
        await rpc('update_demand', {
          p_id: open.id,
          p_changes: { promised_at: when.toISOString() },
          p_message_id: m.messageId,
          p_actor: actor,
        });
      }
      return;
    }

    // 3) cliente: reabertura ou confirmação da última entrega
    const delivered = await latestDemand(m.groupId, ['entregue']);
    const recent =
      delivered?.delivered_at &&
      Date.now() - new Date(delivered.delivered_at).getTime() < params.confirm_window_days * 86_400_000;
    if (delivered && recent) {
      if (findKeyword(m.body, params.reopen_keywords)) {
        await rpc('update_demand', {
          p_id: delivered.id,
          p_changes: { status: 'aberta' },
          p_message_id: m.messageId,
          p_actor: actor,
        });
        await onRework(delivered.id, m.groupId, m.groupName, 'reaberta pelo cliente');
        return;
      }
      if (!delivered.confirmed_at && findKeyword(m.body, params.confirm_keywords)) {
        await rpc('update_demand', {
          p_id: delivered.id,
          p_changes: { confirmed: true },
          p_message_id: m.messageId,
          p_actor: actor,
        });
        return;
      }
    }

    // 4) cliente cobrando uma demanda em aberto
    const open = await latestDemand(m.groupId, ['aberta', 'em_andamento']);
    if (open && findKeyword(m.body, params.followup_keywords)) {
      const updated = (await rpc('register_demand_followup', {
        p_id: open.id,
        p_message_id: m.messageId,
        p_actor: actor,
      })) as Demand | null;
      if (updated && updated.followups_count >= params.followups_threshold) {
        await onRework(open.id, m.groupId, m.groupName, `cobrada ${updated.followups_count} vezes`);
      }
      return;
    }

    // 5) palavra-chave do cliente abre demanda
    if (settings.demand_keyword_enabled && findKeyword(m.body, settings.demand_keywords)) {
      await rpc('create_demand', {
        p_group_id: m.groupId,
        p_description: (m.body ?? '').slice(0, 300),
        p_message_id: m.messageId,
        p_type: classifyCategory(m.body, params.categories),
        p_source: 'keyword',
        p_actor: actor,
      });
      return;
    }

    // 6) classificação por IA (opcional)
    if (
      settings.demand_ai_enabled &&
      aiAvailable() &&
      m.opensPending &&
      m.messageType === 'text' &&
      (m.body ?? '').trim().length >= 15
    ) {
      const result = await classifyDemand(m.body!, params.categories.map((c) => c.name));
      if (result?.is_demand) {
        await rpc('create_demand', {
          p_group_id: m.groupId,
          p_description: result.summary || (m.body ?? '').slice(0, 300),
          p_message_id: m.messageId,
          p_type: result.category || classifyCategory(m.body, params.categories),
          p_source: 'ai',
          p_actor: 'IA',
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'falha ao processar sinais de demanda');
  }
}
