/**
 * Itens do menu lateral e quem pode vê-los (Configurações › Menus, por empresa).
 * Acesso: 'all' = todos os usuários, 'admin' = só administradores, 'none' = oculto para todos.
 * Menu oculto também bloqueia a página (requireMenu).
 */
import { VIEWER_MENUS } from '@/lib/roles';

export type MenuAccess = 'all' | 'admin' | 'none';

export const MENU_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', description: 'Visão da gestão e indicadores.' },
  { href: '/panel', label: 'Painel de grupos', description: 'Todos os grupos em cartões, coloridos pela situação.' },
  { href: '/pending', label: 'Aguardando resposta', description: 'Fila de clientes esperando resposta.' },
  { href: '/demands', label: 'Demandas', description: 'Pedidos dos clientes e entregas.' },
  { href: '/groups', label: 'Grupos', description: 'Lista de grupos, monitoramento e conversas.' },
  { href: '/alerts', label: 'Alertas', description: 'Alertas gerados pelas regras.' },
  { href: '/reports', label: 'Relatórios', description: 'Relatórios para imprimir ou exportar.' },
  // Configurações: nunca some para administradores (ninguém se tranca do lado de fora)
  { href: '/settings', label: 'Configurações', description: 'Configurações do sistema.', alwaysForAdmins: true },
] as const;

export type MenuHref = (typeof MENU_ITEMS)[number]['href'];

/** Acesso configurado de um item (sem valor = todos). */
export function menuAccess(config: Record<string, unknown> | null | undefined, href: string): MenuAccess {
  const v = config?.[href];
  return v === 'admin' || v === 'none' ? v : 'all';
}

/** O usuário pode ver/abrir este menu? (perfil "somente ver painéis": só Dashboard e Painel de grupos) */
export function canSeeMenu(
  config: Record<string, unknown> | null | undefined,
  href: string,
  isAdmin: boolean,
  viewer = false,
): boolean {
  if (viewer && !isAdmin && !VIEWER_MENUS.includes(href)) return false;
  const item = MENU_ITEMS.find((i) => i.href === href);
  if (item && 'alwaysForAdmins' in item && isAdmin) return true;
  const access = menuAccess(config, href);
  return access === 'all' || (access === 'admin' && isAdmin);
}
