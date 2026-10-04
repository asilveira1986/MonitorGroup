'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/format';

const TABS = [
  { href: '/settings', label: 'Geral' },
  { href: '/settings/whatsapp', label: 'WhatsApp' },
  { href: '/settings/indicators', label: 'Indicadores', adminOnly: true },
  { href: '/settings/alerts', label: 'Regras de alerta' },
  { href: '/settings/team', label: 'Equipe' },
  { href: '/settings/users', label: 'Usuários' },
];

export function SettingsTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:gap-1 sm:overflow-x-auto sm:border-b sm:border-line">
      {TABS.filter((t) => isAdmin || !('adminOnly' in t)).map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              // celular: "pílulas" que quebram linha; telas maiores: abas sublinhadas
              'whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition',
              'sm:-mb-px sm:rounded-none sm:border-0 sm:border-b-2 sm:px-4 sm:py-2.5',
              active
                ? 'border-brand bg-brand-soft text-brand sm:border-brand sm:bg-transparent sm:text-ink'
                : 'border-line text-ink-2 hover:text-ink sm:border-transparent',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
