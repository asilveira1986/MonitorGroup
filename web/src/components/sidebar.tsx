'use client';

import {
  Bell,
  Clock,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/format';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pending', label: 'Aguardando resposta', icon: Clock, badgeKey: 'pending' as const },
  { href: '/groups', label: 'Grupos', icon: MessagesSquare },
  { href: '/alerts', label: 'Alertas', icon: Bell, badgeKey: 'alerts' as const },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function Sidebar({ counts }: { counts: { pending: number; alerts: number } }) {
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
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
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
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-surface px-4 py-5 shadow-xl">
            <div className="mb-8 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}
    </>
  );
}
