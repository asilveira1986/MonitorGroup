import { Lock } from 'lucide-react';

export function AdminNotice() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
      <Lock className="h-4 w-4" /> Somente administradores podem alterar estas configurações.
    </div>
  );
}
