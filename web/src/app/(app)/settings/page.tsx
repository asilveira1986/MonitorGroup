import { Building2 } from 'lucide-react';
import { AdminNotice } from '@/components/admin-notice';
import { ImageUpload } from '@/components/image-upload';
import { Card, CardHeader } from '@/components/ui';
import { currentCompany, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings } from '@/lib/types';
import { prepareImageUpload, saveCompanyLogo } from './actions';
import { GeneralForm } from './general-form';
import { Holidays } from './holidays';

/** Organização › Empresa: horário comercial, histórico e feriados. */
export default async function CompanySettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const company = await currentCompany();
  const [{ data }, { data: holidays }, { data: logo }] = await Promise.all([
    supabase.from('app_settings').select('*').single(),
    supabase.from('holidays').select('day, name').order('day'),
    // à parte: sem o script 0083 a coluna não existe e o resto da tela segue normal
    supabase.from('companies').select('logo_path').eq('id', company?.id ?? '').maybeSingle(),
  ]);
  const isAdmin = profile.role === 'admin' || profile.platform_admin;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Logo da empresa" description="Aparece no menu lateral, ao lado do nome da empresa. PNG, JPG, WEBP ou SVG, até 2 MB (de preferência quadrado)." />
        <div className="p-5">
          <ImageUpload
            label="Enviar logo"
            src={(logo as { logo_path?: string | null } | null)?.logo_path ? '/company-logo' : null}
            prepare={prepareImageUpload.bind(null, 'logo')}
            save={saveCompanyLogo}
            disabled={!isAdmin}
            fallback={<Building2 className="h-6 w-6 text-muted" />}
          />
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Empresa"
          description="Horário comercial e importação de histórico, usados nos indicadores e nos alertas."
        />
        <div className="p-5">
          {profile.role !== 'admin' && <AdminNotice />}
          <GeneralForm settings={data as AppSettings} disabled={profile.role !== 'admin'} />
        </div>
      </Card>
      <Holidays holidays={holidays ?? []} isAdmin={profile.role === 'admin'} />
    </div>
  );
}
