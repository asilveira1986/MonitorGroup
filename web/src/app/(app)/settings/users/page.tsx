import { redirect } from 'next/navigation';

/** Endereço antigo: Acessos ao painel ficam em Pessoas (0107). */
export default function OldSettingsPage() {
  redirect('/settings/people');
}
