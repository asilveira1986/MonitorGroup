/**
 * Acesso às telas do sistema, por usuário (Configurações › Pessoas).
 *
 * O padrão de cada pessoa vem do perfil dela (administrador, atendente, só ver painéis, só agenda) e da configuração de menus
 * da empresa (Configurações › Menus). O administrador pode liberar ou bloquear telas só para uma pessoa: isso fica em
 * `profiles.screen_access` ({ "/alerts": false, "/reports": true }), só com o que difere do padrão. Sem entrada, vale o padrão.
 *
 * Telas fixas (`locked`) não se configuram por pessoa: as que são só do administrador da plataforma. Telas `adminDefault`
 * (Grupos, Acompanhamento) são, por padrão, só de administradores, mas o administrador pode liberar para outra pessoa; para
 * administradores ficam sempre ligadas. Quem recebe a liberação vê a tela só para consulta (sem os controles de gestão).
 * Telas `platformDefault` (Painel de privadas) são, por padrão, só do administrador da plataforma (ninguém mais vê, nem o
 * administrador da empresa); o administrador libera para quem quiser, pessoa a pessoa, e por enquanto fica desligada para todos.
 * Sem dependências, para o menu, as páginas, a tela de Pessoas e os testes usarem a mesma regra.
 */
import { canSeeMenu, MENU_ITEMS } from './menu.ts';
import type { Role } from './types.ts';

/**
 * Por que uma tela aparece travada na lista de uma pessoa: 'platform' = fixa, só do administrador da plataforma; 'admin' = esta
 * pessoa sempre tem.
 */
export type ScreenLock = 'platform' | 'admin';

export type ScreenDef = {
  href: string;
  label: string;
  description: string;
  /** seção em que aparece na lista (a mesma do menu lateral) */
  section: string;
  /** tela que não se configura por pessoa (só do administrador da plataforma) */
  locked?: 'platform';
  /** padrão: só administradores; o administrador pode liberar para outra pessoa */
  adminDefault?: true;
  /** padrão: só o administrador da plataforma; o administrador libera para outra pessoa */
  platformDefault?: true;
};

/** Todas as telas do menu lateral, na ordem em que aparecem. */
export const SCREENS: ScreenDef[] = [
  { href: '/dashboard', label: 'Dashboard', description: 'Visão da gestão e indicadores.', section: 'Início' },
  { href: '/agenda', label: 'Agenda', description: 'Compromissos e demandas para entregar, dia a dia.', section: 'Início' },
  { href: '/panel', label: 'Painel de grupos', description: 'Todos os grupos em cartões, coloridos pela situação.', section: 'Grupos' },
  { href: '/groups', label: 'Grupos', description: 'Lista de grupos e monitoramento. Quem recebe só consulta (sem monitorar nem mudar setor).', section: 'Grupos', adminDefault: true },
  { href: '/pending', label: 'Aguardando resposta', description: 'Fila de clientes esperando resposta.', section: 'Grupos' },
  { href: '/demands', label: 'Demandas', description: 'Pedidos dos clientes e entregas.', section: 'Grupos' },
  { href: '/private', label: 'Conversas privadas', description: 'Conversas 1 a 1 do WhatsApp conectado.', section: 'Conversas' },
  { href: '/private-panel', label: 'Painel de privadas', description: 'Cartões das conversas privadas, um por conversa em aberto. Desligado por padrão: libere só para quem precisar.', section: 'Conversas', platformDefault: true },
  { href: '/contacts', label: 'Contatos', description: 'Agenda de contatos do WhatsApp.', section: 'Conversas' },
  { href: '/broadcasts', label: 'Disparos', description: 'Envios em massa.', section: 'Automações', locked: 'platform' },
  { href: '/reports', label: 'Relatórios', description: 'Relatórios para imprimir ou exportar.', section: 'Gestão' },
  { href: '/alerts', label: 'Alertas', description: 'Alertas gerados pelas regras.', section: 'Gestão' },
  { href: '/acompanhamento', label: 'Acompanhamento', description: 'Uso do sistema pelos usuários da empresa. Quem recebe não vê o histórico de atividades de cada pessoa.', section: 'Gestão', adminDefault: true },
  { href: '/platform', label: 'Empresas', description: 'Cadastro das empresas da plataforma.', section: 'Gestão', locked: 'platform' },
  { href: '/notificacoes', label: 'Notificações', description: 'Situação dos avisos de cada usuário.', section: 'Gestão', locked: 'platform' },
  { href: '/logs', label: 'Log', description: 'Registro das atividades dos usuários.', section: 'Gestão', locked: 'platform' },
  { href: '/settings', label: 'Configurações', description: 'Configurações do sistema (quem não é administrador só consulta).', section: 'Configurações' },
];

/** Por que uma tela fixa não se configura. */
export const LOCK_REASON: Record<ScreenLock, string> = {
  admin: 'Sempre liberada para este perfil',
  platform: 'Só o administrador da plataforma',
};

/** Telas que se configuram por pessoa. */
export const EDITABLE_SCREENS = SCREENS.filter((s) => !s.locked);

/** As escolhas guardadas: só entradas booleanas de telas que se configuram; o resto (lixo, tela fixa, tela que não existe) cai fora. */
export function parseScreenAccess(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const s of EDITABLE_SCREENS) {
    const v = (raw as Record<string, unknown>)[s.href];
    if (typeof v === 'boolean') out[s.href] = v;
  }
  return out;
}

type Who = { role: Role; platformAdmin: boolean };

/** Acesso padrão do perfil (sem a escolha pessoal): o que vale hoje para a pessoa, pelo perfil e pelos menus da empresa. */
export function defaultScreenAccess(config: Record<string, unknown> | null | undefined, href: string, who: Who): boolean {
  const isAdmin = who.role === 'admin' || who.platformAdmin;
  // Grupos e Acompanhamento: por padrão só administradores; Painel de privadas: só o administrador da plataforma
  const def = SCREENS.find((s) => s.href === href);
  if (def?.adminDefault) return isAdmin;
  if (def?.platformDefault) return who.platformAdmin;
  // telas que não estão em Configurações › Menus (conversas privadas, contatos...) seguem as próprias regras: aqui não restringem
  if (!MENU_ITEMS.some((i) => i.href === href)) return true;
  return canSeeMenu(config, href, isAdmin, who.role === 'viewer', who.role === 'agenda');
}

/**
 * A pessoa pode abrir esta tela? Tela fixa: pelo perfil. Configurações nunca some para administrador (ninguém se tranca para
 * fora). Senão vale a escolha pessoal, e sem ela o padrão do perfil e dos menus da empresa.
 */
export function canAccessScreen(
  href: string,
  who: Who & { screenAccess?: unknown },
  config: Record<string, unknown> | null | undefined,
): boolean {
  const isAdmin = who.role === 'admin' || who.platformAdmin;
  const def = SCREENS.find((s) => s.href === href);
  if (def?.locked === 'platform') return who.platformAdmin;
  // administradores sempre têm Grupos e Acompanhamento (ninguém se tranca para fora); os demais, só com a liberação
  if (def?.adminDefault && isAdmin) return true;
  // o administrador da plataforma sempre tem as telas dele; as demais pessoas, só com a liberação dele
  if (def?.platformDefault && who.platformAdmin) return true;
  if (href === '/settings' && isAdmin) return true;
  const own = parseScreenAccess(who.screenAccess)[href];
  return typeof own === 'boolean' ? own : defaultScreenAccess(config, href, who);
}

/** Do que foi marcado na tela de Pessoas, só o que difere do padrão da pessoa (null = nada difere: volta ao padrão). */
export function screenAccessOverrides(
  wanted: Record<string, boolean>,
  who: Who,
  config: Record<string, unknown> | null | undefined,
): Record<string, boolean> | null {
  const out: Record<string, boolean> = {};
  const isAdmin = who.role === 'admin' || who.platformAdmin;
  for (const s of EDITABLE_SCREENS) {
    const want = wanted[s.href];
    if (typeof want !== 'boolean') continue;
    // para administradores, Grupos e Acompanhamento ficam sempre ligados: nada a guardar
    if (s.adminDefault && isAdmin) continue;
    if (s.platformDefault && who.platformAdmin) continue;
    if (want !== defaultScreenAccess(config, s.href, who)) out[s.href] = want;
  }
  return Object.keys(out).length ? out : null;
}

/** Endereços das telas que a pessoa não pode abrir (para esconder do menu lateral). */
export function hiddenScreens(who: Who & { screenAccess?: unknown }, config: Record<string, unknown> | null | undefined): string[] {
  return SCREENS.filter((s) => !canAccessScreen(s.href, who, config)).map((s) => s.href);
}
