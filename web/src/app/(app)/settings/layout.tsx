import { PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { SettingsTabs } from './tabs';

export default async function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  const profile = await requireMenu('/settings');
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Conexão com o WhatsApp, indicadores, regras de alerta, equipe, usuários, setores e menus."
      />
      <SettingsTabs isAdmin={profile.role === 'admin'} />
      <div className="mt-6">{children}</div>
    </>
  );
}
