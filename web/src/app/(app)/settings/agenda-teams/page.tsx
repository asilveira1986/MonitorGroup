import { redirect } from 'next/navigation';

/** Endereço antigo: Setores da agenda viraram Setores (0107). */
export default function OldSettingsPage() {
  redirect('/settings/sectors');
}
