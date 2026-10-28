'use client';

import { Bell, BookUser, Building2, CalendarDays, ChevronDown, MessageCircle, ChevronsLeft, ChevronsRight, ClipboardList, Clock, FileBarChart, LayoutDashboard, LayoutGrid, LogOut, Menu, MessagesSquare, ScrollText, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CompanyMenu } from '@/components/company-menu';
import { ProfileDialog, type MyProfile } from '@/components/profile-dialog';
import { Logo } from '@/components/logo';
import { MyAlertsToggle, NotifyToggle } from '@/components/message-notifier';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/roles';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel', label: 'Painel de grupos', icon: LayoutGrid },
  { href: '/pending', label: 'Aguardando resposta', icon: Clock, badgeKey: 'pending' as const },
  { href: '/demands', label: 'Demandas', icon: ClipboardList, badgeKey: 'demands' as const },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays, badgeKey: 'agenda' as const },
  { href: '/groups', label: 'Grupos', icon: MessagesSquare },
  // conversas privadas (0069): só quem administra a plataforma, na empresa com o módulo ligado
  { href: '/private', label: 'Conversas privadas', icon: MessageCircle, badgeKey: 'private' as const },
  // contatos (0112): agenda do WhatsApp + cadastros do sistema; mesmo acesso das conversas privadas
  { href: '/contacts', label: 'Contatos', icon: BookUser },
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
  platformAdmin = false,
  company = null,
  alertsOff,
  companyLogo = false,
  me,
  companies,
  companyId,
}: {
  /** Meu perfil (0085): o bloco do usuário abre a edição */
  me?: MyProfile;
  /** quem administra a plataforma: troca de empresa pela empresa no rodapé do menu */
  companies?: { id: string; name: string; active: boolean; hasLogo?: boolean }[];
  companyId?: string | null;
  /** a empresa tem logo (Configurações › Empresa, 0083): aparece no menu ao lado do nome */
  companyLogo?: boolean;
  /** agenda: demandas do usuário para entregar hoje + atrasadas */
  counts: { pending: number; alerts: number; demands: number; agenda?: number; private?: number };
  /** itens do menu escondidos (ex.: funções desligadas nas configurações) */
  hidden?: string[];
  user: { name: string; role: string; initials?: string; avatarUrl?: string | null };
  /** administra a plataforma: mostra o item Empresas */
  platformAdmin?: boolean;
  /** empresa atual (no rodapé do menu) */
  company?: string | null;
  /** Meus alertas (quem administra a plataforma): undefined = sem o botão */
  alertsOff?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const canSwitch = platformAdmin && Boolean(companies?.length) && Boolean(companyId);
  const companyIcon = companyLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- logo privado por link temporário
    <img src="/company-logo" alt={company ?? ''} className="h-7 w-7 shrink-0 rounded-lg bg-white object-contain p-0.5" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-ink-2">
      <Building2 className="h-3.5 w-3.5" />
    </span>
  );
  const avatar = me?.photoSrc || user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário
    <img src={me?.photoSrc || user.avatarUrl || ''} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#8fc41a] text-[10px] font-bold text-brand-ink">
      {user.initials || user.name.slice(0, 2).toUpperCase()}
    </span>
  );
  const row = 'flex w-full items-center gap-2 rounded-xl px-1.5 py-1 text-left [[data-sidebar=collapsed]_aside_&]:justify-center [[data-sidebar=collapsed]_aside_&]:px-0';

  // rodapé do menu: empresa logada (quem administra a plataforma troca por aqui), usuário (abre
  // Meu perfil), avisos, tema e sair. Recolhido: só os ícones. Não encolhe: a lista acima rola.
  const footer = (
    <div className="mt-2 shrink-0 space-y-1 border-t border-line pt-2">
      {company &&
        (canSwitch ? (
          <CompanyMenu
            companies={companies!.map((c) => ({ ...c, hasLogo: c.id === companyId ? companyLogo : c.hasLogo }))}
            currentId={companyId!}
            rowClass={row}
            hideClass={COLLAPSED_HIDE}
          />
        ) : (
          <div className={row} title={company}>
            {companyIcon}
            <p className={cn('min-w-0 flex-1 truncate text-[calc(0.75rem-1px)] font-semibold leading-tight text-ink', COLLAPSED_HIDE)}>{company}</p>
          </div>
        ))}
      {me ? (
        <ProfileDialog me={me} className={cn(row, 'hover:bg-white/[0.06]')}>
          {avatar}
          <span className={cn('min-w-0 flex-1', COLLAPSED_HIDE)}>
            <span className="block truncate text-[calc(0.875rem-1px)] font-medium leading-tight text-ink">{user.name}</span>
            <span className="block truncate text-[10px] leading-tight text-muted">{ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? 'Atendente'} · meu perfil</span>
          </span>
        </ProfileDialog>
      ) : (
        <div className={row} title={user.name}>
          {avatar}
          <div className={cn('min-w-0 flex-1', COLLAPSED_HIDE)}>
            <p className="truncate text-[calc(0.875rem-1px)] font-medium leading-tight text-ink">{user.name}</p>
            <p className="truncate text-[10px] leading-tight text-muted">{ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? 'Atendente'}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-1 px-0.5 [[data-sidebar=collapsed]_aside_&]:justify-center [[data-sidebar=collapsed]_aside_&]:px-0">
        <div className={cn('flex items-center [&_button]:p-1.5 [&_svg]:h-4 [&_svg]:w-4', COLLAPSED_HIDE)}>
          {alertsOff !== undefined && <MyAlertsToggle off={alertsOff} compact />}
          <NotifyToggle />
          <ThemeToggle />
        </div>
        <form action="/auth/signout" method="post">
          <button className="flex items-center rounded-xl p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink" title="Sair" aria-label="Sair">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );

  const nav = (
    <nav className="space-y-0.5">
      {[
        ...NAV,
        ...(platformAdmin
          ? [
              { href: '/platform', label: 'Empresas', icon: Building2, badgeKey: undefined },
              // log de atividades dos usuários: só quem administra a plataforma
              { href: '/logs', label: 'Log', icon: ScrollText, badgeKey: undefined },
            ]
          : []),
      ]
        .filter((item) => !hidden.includes(item.href))
        .map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const count = badgeKey ? (counts[badgeKey] ?? 0) : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            title={label}
            className={cn(
              'relative flex items-center gap-2.5 rounded-xl px-2.5 py-3 text-sm font-medium transition lg:py-1.5',
              '[[data-sidebar=collapsed]_aside_&]:justify-center [[data-sidebar=collapsed]_aside_&]:px-0',
              // ativo: placa azul-escura da marca, texto claro e ícone em verde-limão
              active ? 'nav-active font-semibold' : 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4 shrink-0 [[data-sidebar=collapsed]_aside_&]:h-5 [[data-sidebar=collapsed]_aside_&]:w-5" />
            <span className={cn('flex-1 whitespace-nowrap', COLLAPSED_HIDE)}>{label}</span>
            {/* recolhido: só um ponto sobre o ícone indicando que há itens */}
            {count > 0 && (
              <span
                className={cn(
                  'absolute right-2.5 top-1.5 hidden h-2 w-2 rounded-full ring-2 ring-surface [[data-sidebar=collapsed]_aside_&]:block',
                  badgeKey === 'alerts' || badgeKey === 'agenda' ? 'bg-critical' : badgeKey === 'private' ? 'bg-good' : badgeKey === 'demands' ? 'bg-ink-2' : 'bg-warning',
                )}
                aria-hidden
              />
            )}
            {count > 0 && (
              <span
                className={cn(
                  COLLAPSED_HIDE,
                  'tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  badgeKey === 'alerts' || badgeKey === 'agenda'
                    ? 'bg-critical text-white'
                    : badgeKey === 'private'
                      ? 'bg-good text-white'
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
      <aside className="theme-deep sidebar-glow fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-3 py-4 transition-[width] duration-200 lg:flex [[data-sidebar=collapsed]_&]:w-[4.5rem] [[data-sidebar=collapsed]_&]:px-3">
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
        <div className="mb-5 px-1.5 [[data-sidebar=collapsed]_&]:px-0">
          {/* nome menor e folga à direita: o botão de recolher fica no canto, sem cobrir o nome */}
          <span className="block pr-8 [[data-sidebar=collapsed]_&]:hidden">
            <Logo size={30} textClassName="text-[0.95rem]" className="gap-2" />
          </span>
          <span className="hidden justify-center [[data-sidebar=collapsed]_&]:flex">
            <Logo compact />
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{nav}</div>
        {footer}
      </aside>

      {/* Mobile */}
      <div data-print-hide className="theme-deep sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <Logo />
          {companyLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- logo privado por link temporário
            <img src="/company-logo" alt={company ?? 'Logo da empresa'} className="h-7 w-7 shrink-0 rounded-lg bg-white object-contain p-0.5" />
          )}
        </span>
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
          <div className="theme-deep sidebar-glow absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-surface px-4 py-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar menu">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
            {footer}
          </div>
        </div>
      )}
    </>
  );
}
