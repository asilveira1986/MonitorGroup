import { PageHeader } from '@/components/ui';
import { SettingsTabs } from './tabs';

export default function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  return (
    <>
      <PageHeader title="Configurações" description="Conexão com o WhatsApp, regras de alerta, equipe e usuários." />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
