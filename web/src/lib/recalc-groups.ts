import { createAdminClient } from '@/lib/supabase/server';

export type RecalcSummary = {
  mensagens_reclassificadas: number;
  grupos_recalculados: number;
  aguardando_antes: number;
  aguardando_depois: number;
  alertas_resolvidos: number;
};

/**
 * Recalcula os grupos da empresa depois de mudar a equipe: mensagens antigas da pessoa
 * passam a contar como da equipe e os grupos já respondidos saem de "aguardando".
 * Roda com a chave de serviço porque mexe em grupos de todos os setores; só chamar
 * depois de conferir a ação do usuário. Sem o script 0040 no banco, não faz nada.
 */
export async function recalcCompanyGroups(companyId: string | null | undefined): Promise<RecalcSummary | null> {
  if (!companyId) return null;
  try {
    const { data, error } = await createAdminClient().rpc('recalc_company_groups', { p_company_id: companyId });
    return error ? null : (data as RecalcSummary);
  } catch {
    return null;
  }
}
