import { isAcknowledgement, isStickerOrEmoji, isThanksAfterTeam } from '@/lib/acknowledgement';
import { recalcCompanyGroups, type RecalcSummary } from '@/lib/recalc-groups';
import { createAdminClient } from '@/lib/supabase/server';

type Rules = { acknowledgements: boolean; stickers: boolean; phrases: string[] };
type Row = { id: string; message_type: string; body: string | null; opens_pending: boolean; ignored_as_last: boolean };

const PAGE = 1000;
const CHUNK = 300;

export type ReapplySummary = { revisadas: number; alteradas: number; grupos: RecalcSummary | null };

/**
 * Aplica as regras de "Mensagens a ignorar" às mensagens de cliente já recebidas (texto e
 * figurinha), com a mesma regra do worker, e recalcula os grupos: o que passou a ser
 * agradecimento deixa de pedir resposta. Pendências só diminuem (ver recalc_company_groups).
 * Usa a chave de serviço: chamar só depois de conferir que o usuário é administrador.
 */
export async function reapplyIgnoreRules(companyId: string, rules: Rules): Promise<ReapplySummary> {
  const db = createAdminClient();
  const toChange = new Map<string, { opens_pending: boolean; ignored_as_last: boolean }>();
  let reviewed = 0;
  let after: string | null = null;

  for (;;) {
    let q = db
      .from('messages')
      .select('id, message_type, body, opens_pending, ignored_as_last, groups!messages_group_id_fkey!inner(company_id)')
      .eq('groups.company_id', companyId)
      .eq('from_team', false)
      .in('message_type', ['text', 'sticker'])
      .order('id')
      .limit(PAGE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Row[];
    for (const m of rows) {
      const ignored = rules.stickers && isStickerOrEmoji(m.message_type, m.body);
      // agradecimento logo depois da equipe (0089) já marcado: continua sem abrir pendência
      const keptThanks = rules.acknowledgements && !m.opens_pending && isThanksAfterTeam(m.message_type, m.body);
      const opens =
        !ignored && !keptThanks && !(rules.acknowledgements && isAcknowledgement(m.message_type, m.body, rules.phrases));
      if (opens !== m.opens_pending || ignored !== Boolean(m.ignored_as_last)) {
        toChange.set(m.id, { opens_pending: opens, ignored_as_last: ignored });
      }
    }
    reviewed += rows.length;
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].id;
  }

  // agrupa por valor novo para atualizar em lotes
  const buckets = new Map<string, string[]>();
  for (const [id, v] of toChange) {
    const key = `${v.opens_pending}|${v.ignored_as_last}`;
    buckets.set(key, [...(buckets.get(key) ?? []), id]);
  }
  for (const [key, ids] of buckets) {
    const [opens, ignored] = key.split('|').map((x) => x === 'true');
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await db
        .from('messages')
        .update({ opens_pending: opens, ignored_as_last: ignored })
        .in('id', ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
    }
  }

  const grupos = toChange.size ? await recalcCompanyGroups(companyId) : null;
  return { revisadas: reviewed, alteradas: toChange.size, grupos };
}
