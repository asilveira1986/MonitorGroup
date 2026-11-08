'use client';

import {
  Activity,
  Bell,
  BookUser,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  FileBarChart,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/format';
import {
  activeGroupId,
  badgeKind,
  badgeText,
  groupBadge,
  isActive,
  isGroupOpen,
  NAV_TREE,
  parseGroupPrefs,
  visibleNav,
  type BadgeKind,
  type IconKey,
  type NavCounts,
  type NavGroup,
  type NavItem,
} from '@/lib/nav';

const ICONS: Record<IconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  panel: LayoutGrid,
  pending: Clock,
  demands: ClipboardList,
  agenda: CalendarDays,
  groups: MessagesSquare,
  private: MessageCircle,
  contacts: BookUser,
  broadcasts: Megaphone,
  alerts: Bell,
  reports: FileBarChart,
  settings: Settings,
  platform: Building2,
  tracking: Activity,
  logs: ScrollText,
  groupsGroup: Users,
  chatsGroup: MessageSquareText,
  automationGroup: Zap,
  managementGroup: SlidersHorizontal,
};

// variante válida só no menu fixo da tela grande quando ele está recolhido (o do celular não muda)
const COLLAPSED_HIDE = '[[data-sidebar=collapsed]_aside_&]:hidden';
const COLLAPSED_SHOW = '[[data-sidebar=collapsed]_aside_&]:block';

const PILL: Record<BadgeKind, string> = {
  critical: 'bg-critical text-white',
  good: 'bg-good text-white',
  neutral: 'bg-surface-2 text-ink-2 ring-1 ring-line',
  warning: 'bg-warning text-black',
};
const DOT: Record<BadgeKind, string> = { critical: 'bg-critical', good: 'bg-good', neutral: 'bg-ink-2', warning: 'bg-warning' };

// quais grupos a pessoa deixou abertos ou fechados, lembrado neste navegador
const PREFS_KEY = 'sidebar-groups';
const PREFS_EVENT = 'sidebar-groups-change';

function subscribePrefs(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(PREFS_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(PREFS_EVENT, callback);
  };
}
function readPrefs(): string {
  try {
    return localStorage.getItem(PREFS_KEY) ?? '';
  } catch {
    return '';
  }
}
function writePrefs(prefs: Record<string, boolean>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento local: vale só até recarregar */
  }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

/**
 * Itens do menu lateral: Dashboard e Agenda soltos, grupos com submenu (abrem e fecham, o grupo da página
 * atual abre sozinho) e Configurações no fim. O mesmo componente serve ao menu fixo e ao do celular.
 */
export function SidebarNav({
  pathname,
  counts,
  hidden = [],
  platformAdmin = false,
  onNavigate,
}: {
  pathname: string;
  counts: NavCounts;
  /** itens escondidos (funções desligadas, Configurações › Menus) */
  hidden?: string[];
  platformAdmin?: boolean;
  onNavigate?: () => void;
}) {
  const tree = visibleNav(NAV_TREE, { hidden, platformAdmin });
  const activeId = activeGroupId(tree, pathname);
  const prefs = parseGroupPrefs(useSyncExternalStore(subscribePrefs, readPrefs, () => ''));
  const [closedHere, setClosedHere] = useState<{ id: string; path: string } | null>(null);

  const toggle = (g: NavGroup, open: boolean) => {
    if (activeId === g.id) setClosedHere(open ? { id: g.id, path: pathname } : null);
    else writePrefs({ ...prefs, [g.id]: !open });
  };

  const renderItem = (item: NavItem, nested = false) => {
    const Icon = ICONS[item.icon];
    const active = isActive(pathname, item.href);
    const count = item.badgeKey ? (counts[item.badgeKey] ?? 0) : 0;
    const kind = item.badgeKey ? badgeKind(item.badgeKey) : 'warning';
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center rounded-xl py-3 text-sm font-medium transition lg:py-1.5',
          // dentro de um grupo o item é um pouco mais justo, para o nome e o contador caberem com o recuo
          nested ? 'gap-2 px-2' : 'gap-2.5 px-2.5',
          '[[data-sidebar=collapsed]_aside_&]:justify-center [[data-sidebar=collapsed]_aside_&]:px-0',
          // ativo: placa azul-escura da marca, texto claro e ícone em verde-limão
          active ? 'nav-active font-semibold' : 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
        )}
      >
        <Icon className="h-4 w-4 shrink-0 [[data-sidebar=collapsed]_aside_&]:h-5 [[data-sidebar=collapsed]_aside_&]:w-5" />
        <span className={cn('flex-1 whitespace-nowrap', COLLAPSED_HIDE)}>{item.label}</span>
        {/* recolhido: só um ponto sobre o ícone indicando que há itens */}
        {count > 0 && <span className={cn('absolute right-2.5 top-1.5 hidden h-2 w-2 rounded-full ring-2 ring-surface', COLLAPSED_SHOW, DOT[kind])} aria-hidden />}
        {count > 0 && <span className={cn(COLLAPSED_HIDE, 'tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none', PILL[kind])}>{badgeText(count)}</span>}
      </Link>
    );
  };

  return (
    <nav className="space-y-0.5" aria-label="Menu principal">
      {tree.map((entry) => {
        if (entry.kind === 'item') return renderItem(entry);
        const open = isGroupOpen({ group: entry, activeId, prefs, closedHere, pathname });
        const Icon = ICONS[entry.icon];
        const badge = open ? null : groupBadge(entry, counts);
        const listId = `nav-group-${entry.id}`;
        return (
          <div key={entry.id}>
            {/* recolhido: uma linha fina separa os grupos, sem o título */}
            <div className={cn('mx-2 my-2 hidden border-t border-line', COLLAPSED_SHOW)} aria-hidden />
            <button
              type="button"
              onClick={() => toggle(entry, open)}
              aria-expanded={open}
              aria-controls={listId}
              className={cn(
                'mt-1.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted transition hover:text-ink-2 lg:py-1',
                COLLAPSED_HIDE,
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">{entry.label}</span>
              {badge && (
                <span className={cn('tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case leading-none tracking-normal', PILL[badge.kind])}>{badgeText(badge.count)}</span>
              )}
              <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
            </button>
            <div
              id={listId}
              className={cn(
                'ml-3 space-y-0.5 border-l border-line pl-1',
                !open && 'hidden',
                // recolhido: todos os ícones aparecem, sem recuo
                `${COLLAPSED_SHOW} [[data-sidebar=collapsed]_aside_&]:ml-0 [[data-sidebar=collapsed]_aside_&]:border-0 [[data-sidebar=collapsed]_aside_&]:pl-0`,
              )}
            >
              {entry.items.map((i) => renderItem(i, true))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
