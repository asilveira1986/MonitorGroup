import { PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { SettingsTabs } from './tabs';

export default async function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  const profile = await requireMenu('/settings');
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Empresa, WhatsApp, usuários, equipe, setores, menus, indicadores e alertas (regras, avisos em tela e aviso por voz)."
      />
      <SettingsTabs isAdmin={profile.role === 'admin'} />
      <div className="mt-6">{children}</div>
    </>
  );
}
