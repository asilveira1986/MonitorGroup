import { check, db, type AppSettings, type TeamMemberRow } from './db.js';
import { logger } from './logger.js';
import { phoneFromJid, samePhone } from './text.js';

const REFRESH_MS = 60_000;

let settings: AppSettings | null = null;
let team: TeamMemberRow[] = [];
let loadedAt = 0;

export async function refreshCache(force = false) {
  if (!force && Date.now() - loadedAt < REFRESH_MS && settings) return;
  try {
    settings = check(await db.from('app_settings').select('*').eq('id', 1).single(), 'load settings') as AppSettings;
    team = (check(await db.from('team_members').select('*').eq('active', true), 'load team') ?? []) as TeamMemberRow[];
    loadedAt = Date.now();
  } catch (err) {
    logger.error({ err }, 'falha ao carregar configurações');
    if (!settings) throw err;
  }
}

export async function getSettings(): Promise<AppSettings> {
  await refreshCache();
  return settings!;
}

/** Procura o atendente da equipe que corresponde ao remetente. */
export async function findTeamMember(...jids: (string | null | undefined)[]): Promise<TeamMemberRow | null> {
  await refreshCache();
  const candidates = jids.filter(Boolean) as string[];
  const phones = candidates.map(phoneFromJid).filter(Boolean) as string[];
  return (
    team.find(
      (m) => (m.jid && candidates.includes(m.jid)) || (m.phone && phones.some((p) => samePhone(p, m.phone!))),
    ) ?? null
  );
}
