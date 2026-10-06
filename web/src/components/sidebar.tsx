'use client';

import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,
  FileBarChart,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessagesSquare,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/format';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel', label: 'Painel de grupos', icon: LayoutGrid },
  { href: '/pending', label: 'Aguardando resposta', icon: Clock, badgeKey: 'pending' as const },
  { href: '/demands', label: 'Demandas', icon: ClipboardList, badgeKey: 'demands' as const },
  { href: '/groups', label: 'Grupos', icon: MessagesSquare },
  { href: '/alerts', label: 'Alertas', icon: Bell, badgeKey: 'alerts' as const },
  { href: '/reports', label: 'Relatórios', icon: FileBarChart },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

// variantes válidas só no menu fixo da tela grande quando ele está recolhido
// (o menu do celular usa a mesma lista e não muda)
const COLLAPSED_HIDE = '[[data-sidebar=collapsed]_aside_&]:hidden';

/** Recolhe/expande o menu lateral e lembra a escolha neste navegador. */
function toggleSidebar() {
  const root = document.documentElement;
  const collapsed = root.dataset.sidebar !== 'collapsed';
  if (collapsed) root.dataset.sidebar = 'collapsed';
  else delete root.dataset.sidebar;
  try {
    localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* sem armazenamento local */
  }
}

export function Sidebar({
  hidden = [],
  counts,
  user,
}: {
  counts: { pending: number; alerts: number; demands: number };
  /** itens do menu escondidos (ex.: funções desligadas nas configurações) */
  hidden?: string[];
  user: { name: string; role: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="space-y-1">
      {NAV.filter((item) => !hidden.includes(item.href)).map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const count = badgeKey ? counts[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            title={label}
            className={cn(
              'relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition lg:py-2',
              '[[data-sidebar=collapsed]_aside_&]:justify-center [[data-sidebar=collapsed]_aside_&]:px-0',
              active ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4 shrink-0 [[data-sidebar=collapsed]_aside_&]:h-5 [[data-sidebar=collapsed]_aside_&]:w-5" />
            <span className={cn('flex-1 whitespace-nowrap', COLLAPSED_HIDE)}>{label}</span>
            {/* recolhido: só um ponto sobre o ícone indicando que há itens */}
            {count > 0 && (
              <span
                className={cn(
                  'absolute right-2.5 top-1.5 hidden h-2 w-2 rounded-full ring-2 ring-surface [[data-sidebar=collapsed]_aside_&]:block',
                  badgeKey === 'alerts' ? 'bg-critical' : badgeKey === 'demands' ? 'bg-ink-2' : 'bg-warning',
                )}
                aria-hidden
              />
            )}
            {count > 0 && (
              <span
                className={cn(
                  COLLAPSED_HIDE,
                  'tabular rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  badgeKey === 'alerts'
                    ? 'bg-critical text-white'
                    : badgeKey === 'demands'
                      ? 'bg-surface-2 text-ink-2 ring-1 ring-line'
                      : 'bg-warning text-black',
                )}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-5 transition-[width] duration-200 lg:flex [[data-sidebar=collapsed]_&]:w-[4.5rem] [[data-sidebar=collapsed]_&]:px-3">
        {/* recolher/expandir: discreto, no canto superior direito (vira uma aba na borda quando recolhido) */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="absolute right-3 top-6 flex h-7 w-7 items-center justify-center rounded-lg text-muted opacity-70 transition hover:bg-surface-2 hover:text-ink hover:opacity-100 [[data-sidebar=collapsed]_&]:-right-3.5 [[data-sidebar=collapsed]_&]:h-7 [[data-sidebar=collapsed]_&]:w-7 [[data-sidebar=collapsed]_&]:rounded-full [[data-sidebar=collapsed]_&]:border [[data-sidebar=collapsed]_&]:border-line [[data-sidebar=collapsed]_&]:bg-surface [[data-sidebar=collapsed]_&]:shadow-sm"
          title="Recolher / expandir o menu"
          aria-label="Recolher ou expandir o menu lateral"
        >
          <ChevronsLeft className="h-4 w-4 [[data-sidebar=collapsed]_&]:hidden" />
          <ChevronsRight className="hidden h-4 w-4 [[data-sidebar=collapsed]_&]:block" />
        </button>
        <div className="mb-8 px-2 [[data-sidebar=collapsed]_&]:px-0">
          <span className="[[data-sidebar=collapsed]_&]:hidden">
            <Logo />
          </span>
          <span className="hidden justify-center [[data-sidebar=collapsed]_&]:flex">
            <Logo compact />
          </span>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">{nav}</div>
      </aside>

      {/* Mobile */}
      <div data-print-hide className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-lg p-2.5 text-ink-2 hover:bg-surface-2"
          aria-label="Abrir menu"
        >
          <Menu className="h-6 w-6" />
          {counts.pending + counts.alerts > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-critical ring-2 ring-surface" />
          )}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-surface px-4 py-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar menu">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between px-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted">{user.role === 'admin' ? 'Administrador' : 'Atendente'}</p>
                </div>
                <ThemeToggle />
              </div>
              <form action="/auth/signout" method="post" className="mt-3">
                <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-ink-2 hover:bg-surface-2">
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
