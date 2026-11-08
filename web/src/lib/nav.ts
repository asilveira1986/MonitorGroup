/**
 * Estrutura do menu lateral: itens soltos e grupos com submenu. Sem dependências (nem ícones), para o menu,
 * o menu do celular e os testes usarem a mesma lógica. Os ícones são só nomes; o componente os traduz.
 */

export type BadgeKey = 'pending' | 'alerts' | 'demands' | 'agenda' | 'private';

export type IconKey =
  | 'dashboard'
  | 'panel'
  | 'pending'
  | 'demands'
  | 'agenda'
  | 'groups'
  | 'private'
  | 'contacts'
  | 'broadcasts'
  | 'alerts'
  | 'reports'
  | 'settings'
  | 'platform'
  | 'tracking'
  | 'logs'
  | 'groupsGroup'
  | 'chatsGroup'
  | 'automationGroup'
  | 'managementGroup';

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
  badgeKey?: BadgeKey;
  /** só quem administra a plataforma vê */
  platformOnly?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: IconKey;
  /** aberto quando a pessoa nunca mexeu nele */
  defaultOpen?: boolean;
  items: NavItem[];
};

export type NavEntry = ({ kind: 'item' } & NavItem) | ({ kind: 'group' } & NavGroup);

export type NavCounts = Partial<Record<BadgeKey, number>>;

/** O menu: Dashboard e Agenda soltos, depois os grupos, e Configurações no fim. */
export const NAV_TREE: NavEntry[] = [
  { kind: 'item', href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { kind: 'item', href: '/agenda', label: 'Agenda', icon: 'agenda', badgeKey: 'agenda' },
  {
    kind: 'group',
    id: 'grupos',
    label: 'Grupos',
    icon: 'groupsGroup',
    defaultOpen: true,
    items: [
      { href: '/panel', label: 'Painel de grupos', icon: 'panel' },
      { href: '/groups', label: 'Grupos', icon: 'groups' },
      { href: '/pending', label: 'Aguardando resposta', icon: 'pending', badgeKey: 'pending' },
      { href: '/demands', label: 'Demandas', icon: 'demands', badgeKey: 'demands' },
    ],
  },
  {
    kind: 'group',
    id: 'conversas',
    label: 'Conversas',
    icon: 'chatsGroup',
    defaultOpen: true,
    items: [
      // conversas privadas (0069) e contatos (0112): mesmo acesso, na empresa com o módulo ligado
      { href: '/private', label: 'Conversas privadas', icon: 'private', badgeKey: 'private' },
      { href: '/contacts', label: 'Contatos', icon: 'contacts' },
    ],
  },
  {
    kind: 'group',
    id: 'automacoes',
    label: 'Automações',
    icon: 'automationGroup',
    // disparos em massa (0150): por enquanto só o administrador geral da plataforma (o layout esconde dos demais)
    items: [{ href: '/broadcasts', label: 'Disparos', icon: 'broadcasts' }],
  },
  {
    kind: 'group',
    id: 'gestao',
    label: 'Gestão',
    icon: 'managementGroup',
    items: [
      { href: '/platform', label: 'Empresas', icon: 'platform', platformOnly: true },
      { href: '/reports', label: 'Relatórios', icon: 'reports' },
      { href: '/alerts', label: 'Alertas', icon: 'alerts', badgeKey: 'alerts' },
      // uso da plataforma por empresa (0135)
      { href: '/acompanhamento', label: 'Acompanhamento', icon: 'tracking', platformOnly: true },
      // log de atividades dos usuários: só quem administra a plataforma
      { href: '/logs', label: 'Log', icon: 'logs', platformOnly: true },
    ],
  },
  { kind: 'item', href: '/settings', label: 'Configurações', icon: 'settings' },
];

/**
 * O que a pessoa vê: sem os itens escondidos (funções desligadas, Configurações › Menus) e sem os exclusivos da
 * plataforma para quem não a administra. Grupo sem nenhum item visível some.
 */
export function visibleNav(tree: NavEntry[], opts: { hidden: string[]; platformAdmin: boolean }): NavEntry[] {
  const show = (i: NavItem) => !opts.hidden.includes(i.href) && (!i.platformOnly || opts.platformAdmin);
  const out: NavEntry[] = [];
  for (const e of tree) {
    if (e.kind === 'item') {
      if (show(e)) out.push(e);
    } else {
      const items = e.items.filter(show);
      if (items.length > 0) out.push({ ...e, items });
    }
  }
  return out;
}

/** A página atual é deste item? (também as subpáginas: /groups/123 é de /groups) */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Id do grupo que contém a página atual (ou null). */
export function activeGroupId(tree: NavEntry[], pathname: string): string | null {
  for (const e of tree) {
    if (e.kind === 'group' && e.items.some((i) => isActive(pathname, i.href))) return e.id;
  }
  return null;
}

export type BadgeKind = 'critical' | 'warning' | 'good' | 'neutral';

/** Cor do contador de cada tipo (alertas e agenda: vermelho; pendências: laranja; privadas: verde). */
export function badgeKind(key: BadgeKey): BadgeKind {
  return key === 'alerts' || key === 'agenda' ? 'critical' : key === 'private' ? 'good' : key === 'demands' ? 'neutral' : 'warning';
}

const KIND_RANK: Record<BadgeKind, number> = { critical: 3, warning: 2, good: 1, neutral: 0 };

/** Contador do grupo fechado: a soma dos itens, na cor do mais urgente. Sem nada pendente: null. */
export function groupBadge(group: NavGroup, counts: NavCounts): { count: number; kind: BadgeKind } | null {
  let count = 0;
  let kind: BadgeKind | null = null;
  for (const i of group.items) {
    const n = i.badgeKey ? (counts[i.badgeKey] ?? 0) : 0;
    if (n <= 0 || !i.badgeKey) continue;
    count += n;
    const k = badgeKind(i.badgeKey);
    if (kind === null || KIND_RANK[k] > KIND_RANK[kind]) kind = k;
  }
  return kind && count > 0 ? { count, kind } : null;
}

/** Texto do contador ("99+" a partir de 100). */
export const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

/** Escolhas guardadas no navegador: { grupo: aberto? }. Lixo ou ausente vira {}. */
export function parseGroupPrefs(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * O grupo está aberto? O da página atual abre sozinho (a menos que a pessoa o tenha fechado nesta mesma
 * página); os outros seguem a última escolha dela, e sem escolha, o padrão do grupo.
 */
export function isGroupOpen(opts: {
  group: Pick<NavGroup, 'id' | 'defaultOpen'>;
  activeId: string | null;
  prefs: Record<string, boolean>;
  closedHere: { id: string; path: string } | null;
  pathname: string;
}): boolean {
  const { group, activeId, prefs, closedHere, pathname } = opts;
  if (activeId === group.id) return !(closedHere && closedHere.id === group.id && closedHere.path === pathname);
  return prefs[group.id] ?? Boolean(group.defaultOpen);
}
