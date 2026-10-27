import { redirect } from 'next/navigation';

/** Endereço antigo: Atendentes ficam em Pessoas (0107). */
export default function OldSettingsPage() {
  redirect('/settings/people');
}
