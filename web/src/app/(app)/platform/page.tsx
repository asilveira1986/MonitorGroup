import { Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Company } from '@/lib/types';
import { CompanyCard, NewCompanyForm } from './companies';

export const metadata: Metadata = { title: 'Monitor Group · Empresas' };

/**
 * Administração da plataforma: as empresas clientes. Cada empresa tem os seus dados, o seu
 * WhatsApp e os seus usuários, isolados das demais. Aqui se cadastra a empresa com o primeiro
 * administrador, se libera ou suspende o acesso, se ajustam os limites e se entra nela para suporte.
 */
export default async function PlatformPage() {
  const me = await requirePlatformAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc('platform_companies');
  const companies = (data ?? []) as Company[];
  const active = companies.filter((c) => c.active).length;

  return (
    <>
      <PageHeader
        title="Empresas"
        description={`${companies.length} empresa(s) cadastrada(s) · ${active} com acesso liberado. Cada empresa vê só os próprios grupos, WhatsApp, usuários e configurações.`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader
            title="Nova empresa"
            description="Cadastra a empresa já pronta para usar (configurações, setor Geral e regras de alerta padrão) e o administrador dela."
          />
          <div className="px-4 pb-5 sm:px-5">
            <NewCompanyForm />
          </div>
        </Card>
        <div className="space-y-4">
          {companies.length === 0 ? (
            <Card>
              <EmptyState icon={<Building2 />} title="Nenhuma empresa" description="Cadastre a primeira empresa ao lado." />
            </Card>
          ) : (
            companies.map((c) => <CompanyCard key={c.id} company={c} current={c.id === me.company_id} />)
          )}
        </div>
      </div>
    </>
  );
}
