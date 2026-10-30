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
/** mensagens rápidas por empresa (atalho -> texto), para reconhecer o \fechamento */
let quickReplies = new Map<string, Map<string, string>>();
/** números de WhatsApp conectados de cada empresa (telefone e nome no WhatsApp) */
let companyNumbers = new Map<string, { phone: string; name: string }[]>();
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
    // sem o script 0042 a tabela não existe: segue sem fechamento
    const { data: qr } = await db.from('quick_replies').select('company_id, shortcut, body');
    quickReplies = new Map();
    for (const r of (qr ?? []) as { company_id: string; shortcut: string; body: string }[]) {
      if (!quickReplies.has(r.company_id)) quickReplies.set(r.company_id, new Map());
      quickReplies.get(r.company_id)!.set(r.shortcut, r.body);
    }
    const { data: inst } = await db.from('whatsapp_instances').select('company_id, phone, push_name, name');
    companyNumbers = new Map();
    for (const i of (inst ?? []) as { company_id: string; phone: string | null; push_name: string | null; name: string | null }[]) {
      if (!i.phone) continue;
      const row = { phone: i.phone, name: i.push_name || i.name || 'Número da empresa' };
      companyNumbers.set(i.company_id, [...(companyNumbers.get(i.company_id) ?? []), row]);
    }
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

/**
 * Outro número de WhatsApp conectado da mesma empresa: num grupo com dois números da empresa, o que um
 * envia chega ao outro como de um membro qualquer; é sempre a empresa (equipe), nunca cliente.
 */
export async function findCompanyNumber(
  companyId: string,
  ...jids: (string | null | undefined)[]
): Promise<{ phone: string; name: string } | null> {
  await refreshCache();
  const phones = jids.filter(Boolean).map((j) => phoneFromJid(j as string)).filter(Boolean) as string[];
  return (companyNumbers.get(companyId) ?? []).find((n) => phones.some((p) => samePhone(p, n.phone))) ?? null;
}

/** Texto da mensagem rápida que encerra a conversa (Configurações › Mensagens rápidas). */
export async function closingTemplate(companyId: string): Promise<string | null> {
  const s = await getSettings(companyId);
  return quickReplies.get(companyId)?.get(s.closing_shortcut || 'fechamento') ?? null;
}
