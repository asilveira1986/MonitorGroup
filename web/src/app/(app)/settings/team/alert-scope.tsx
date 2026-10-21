'use client';

import { BellRing } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/format';
import { setMemberAlertsOwnGroups } from '../actions';

/**
 * Administrador: a pessoa recebe os avisos (tela, voz, WhatsApp e e-mail) só dos grupos em que é
 * responsável, ou de todos os grupos.
 */
export function AlertScope({ member, groups }: { member: { id: string; name: string; alerts_own_groups_only?: boolean }; groups: number }) {
  const [only, setOnly] = useState(Boolean(member.alerts_own_groups_only));
  const [pending, start] = useTransition();
  const change = (next: boolean) => {
    setOnly(next);
    start(async () => {
      const res = await setMemberAlertsOwnGroups(member.id, next);
      if (!res.ok) {
        setOnly(!next);
        return void toast.error(res.error);
      }
      toast.success(next ? `${member.name} recebe avisos só dos seus grupos (${groups})` : `${member.name} recebe avisos de todos os grupos`);
    });
  };
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
        only ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:bg-surface-2',
        pending && 'opacity-60',
      )}
      title="Avisos em tela, voz e os avisos das regras por WhatsApp/e-mail. Alertas sem grupo (ex.: WhatsApp desconectado) continuam chegando."
    >
      <BellRing className="h-3.5 w-3.5" aria-hidden />
      <select
        value={only ? 'own' : 'all'}
        disabled={pending}
        onChange={(e) => change(e.target.value === 'own')}
        aria-label={`Avisos de ${member.name}`}
        className="cursor-pointer bg-transparent outline-none"
      >
        <option value="all">Avisos de todos os grupos</option>
        <option value="own">Avisos só dos seus grupos ({groups})</option>
      </select>
    </label>
  );
}
