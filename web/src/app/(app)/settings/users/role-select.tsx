'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { Role } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/roles';
import { updateUser } from '../actions';

/** Perfil do usuário: administrador, atendente ou somente ver painéis. */
export function RoleSelect({ userId, role }: { userId: string; role: Role }) {
  const [value, setValue] = useState<Role>(role);
  const [pending, start] = useTransition();
  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Perfil do usuário"
      onChange={(e) => {
        const next = e.target.value as Role;
        const prev = value;
        setValue(next);
        start(async () => {
          const res = await updateUser(userId, { role: next });
          if (res.ok) toast.success('Perfil atualizado');
          else {
            setValue(prev);
            toast.error(res.error);
          }
        });
      }}
      className="h-8 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink outline-none focus:border-brand-line"
    >
      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}
