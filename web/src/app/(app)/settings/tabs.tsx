'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/format';

const TABS = [
  { href: '/settings', label: 'Geral' },
  { href: '/settings/whatsapp', label: 'WhatsApp' },
  { href: '/settings/alerts', label: 'Regras de alerta' },
  { href: '/settings/team', label: 'Equipe' },
  { href: '/settings/users', label: 'Usuários' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition',
              active ? 'border-brand text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
