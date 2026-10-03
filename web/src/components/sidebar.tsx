'use client';

import { Bell, Clock, LayoutDashboard, LogOut, Menu, MessagesSquare, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/format';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pending', label: 'Aguardando resposta', icon: Clock, badgeKey: 'pending' as const },
  { href: '/groups', label: 'Grupos', icon: MessagesSquare },
  { href: '/alerts', label: 'Alertas', icon: Bell, badgeKey: 'alerts' as const },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function Sidebar({
  counts,
  user,
}: {
  counts: { pending: number; alerts: number };
  user: { name: string; role: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="space-y-1">
      {NAV.map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const count = badgeKey ? counts[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition lg:py-2',
              active ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 whitespace-nowrap">{label}</span>
            {count > 0 && (
              <span
                className={cn(
                  'tabular rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  badgeKey === 'alerts' ? 'bg-critical text-white' : 'bg-warning text-black',
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        {nav}
      </aside>

      {/* Mobile */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
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
