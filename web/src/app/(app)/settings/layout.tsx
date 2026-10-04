import { PageHeader } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { SettingsTabs } from './tabs';

export default async function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  const profile = await requireProfile();
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Conexão com o WhatsApp, indicadores, regras de alerta, equipe e usuários."
      />
      <SettingsTabs isAdmin={profile.role === 'admin'} />
      <div className="mt-6">{children}</div>
    </>
  );
}
