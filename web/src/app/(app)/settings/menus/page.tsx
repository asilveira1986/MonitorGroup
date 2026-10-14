import { AdminNotice } from '@/components/admin-notice';
import { Card, CardHeader } from '@/components/ui';
import { menuConfig, requireProfile } from '@/lib/auth';
import { menuAccess, MENU_ITEMS } from '@/lib/menu';
import { MenuAccessForm } from './menu-access';

/** Configurações › Menus: quais itens do menu lateral ficam disponíveis, e para quem. */
export default async function MenusSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== 'admin' && !profile.platform_admin) return <AdminNotice />;
  const config = await menuConfig();
  return (
    <Card>
      <CardHeader
        title="Menus do menu lateral"
        description="Escolha quais menus ficam disponíveis e para quem. Menu oculto também bloqueia a página: quem abrir pelo endereço volta para o primeiro menu liberado."
      />
      <div className="px-4 pb-5 sm:px-5">
        <MenuAccessForm
          items={MENU_ITEMS.map((i) => ({
            href: i.href,
            label: i.label,
            description: i.description,
            locked: 'alwaysForAdmins' in i,
            access: menuAccess(config, i.href),
          }))}
        />
      </div>
    </Card>
  );
}
