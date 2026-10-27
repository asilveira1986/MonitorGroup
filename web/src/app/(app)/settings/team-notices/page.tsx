import { redirect } from 'next/navigation';

/** Endereço antigo: Avisos no WhatsApp ficam em Avisos automáticos. */
export default function OldSettingsPage() {
  redirect('/settings/notices');
}
