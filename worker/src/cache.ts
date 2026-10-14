import { check, db, type AppSettings, type TeamMemberRow } from './db.js';
import { logger } from './logger.js';
import { phoneFromJid, samePhone } from './text.js';

const REFRESH_MS = 60_000;

/**
 * Configurações, equipe e situação de cada empresa (multiempresa: um worker atende todas).
 * Recarregado a cada minuto: mudanças no painel valem sem reiniciar o worker.
 */
let settings = new Map<string, AppSettings>();
let team = new Map<string, TeamMemberRow[]>();
let companies = new Map<string, { name: string; active: boolean }>();
let loadedAt = 0;

export async function refreshCache(force = false) {
  if (!force && Date.now() - loadedAt < REFRESH_MS && settings.size) return;
  try {
    const rows = (check(await db.from('app_settings').select('*'), 'load settings') ?? []) as AppSettings[];
    const members = (check(await db.from('team_members').select('*').eq('active', true), 'load team') ??
      []) as TeamMemberRow[];
    const list = (check(await db.from('companies').select('id, name, active'), 'load companies') ?? []) as {
      id: string;
      name: string;
      active: boolean;
    }[];
    settings = new Map(rows.map((s) => [s.company_id, s]));
    team = new Map();
    for (const m of members) team.set(m.company_id, [...(team.get(m.company_id) ?? []), m]);
    companies = new Map(list.map((c) => [c.id, { name: c.name, active: c.active }]));
    loadedAt = Date.now();
  } catch (err) {
    logger.error({ err }, 'falha ao carregar configurações');
    if (!settings.size) throw err;
  }
}

/** Configurações da empresa. */
export async function getSettings(companyId: string): Promise<AppSettings> {
  await refreshCache();
  let s = settings.get(companyId);
  if (!s) {
    // empresa criada há pouco: recarrega uma vez
    await refreshCache(true);
    s = settings.get(companyId);
  }
  if (!s) throw new Error(`configurações da empresa ${companyId} não encontradas`);
  return s;
}

/** Empresa ativa? (suspensa: o worker não conecta nem gera alertas) */
export async function isCompanyActive(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  await refreshCache();
  return companies.get(companyId)?.active ?? false;
}

/** Empresas ativas (verificações periódicas de alertas). */
export async function activeCompanyIds(): Promise<string[]> {
  await refreshCache();
  return [...companies.entries()].filter(([, c]) => c.active).map(([id]) => id);
}

/** Procura, na equipe da empresa, o atendente que corresponde ao remetente. */
export async function findTeamMember(
  companyId: string,
  ...jids: (string | null | undefined)[]
): Promise<TeamMemberRow | null> {
  await refreshCache();
  const candidates = jids.filter(Boolean) as string[];
  const phones = candidates.map(phoneFromJid).filter(Boolean) as string[];
  return (
    (team.get(companyId) ?? []).find(
      (m) => (m.jid && candidates.includes(m.jid)) || (m.phone && phones.some((p) => samePhone(p, m.phone!))),
    ) ?? null
  );
}
