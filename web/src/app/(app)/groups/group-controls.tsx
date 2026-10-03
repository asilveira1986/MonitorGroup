'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Toggle } from '@/components/ui';
import { useRealtime } from '@/lib/use-realtime';
import { markSenderAsTeam, setGroupMonitored, setGroupSla } from '../actions';

export function MonitorToggle({ groupId, monitored, label }: { groupId: string; monitored: boolean; label?: string }) {
  const [value, setValue] = useState(monitored);
  const [pending, start] = useTransition();
  return (
    <Toggle
      checked={value}
      disabled={pending}
      label={label}
      onChange={(checked) => {
        setValue(checked);
        start(async () => {
          const res = await setGroupMonitored(groupId, checked);
          if (!res.ok) {
            setValue(!checked);
            toast.error(res.error);
          } else toast.success(checked ? 'Grupo monitorado' : 'Grupo ignorado');
        });
      }}
    />
  );
}

export function SlaForm({ groupId, sla, defaultSla }: { groupId: string; sla: number | null; defaultSla: number }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      action={(form) =>
        start(async () => {
          const raw = String(form.get('sla') ?? '').trim();
          const res = await setGroupSla(groupId, raw ? Number(raw) : null);
          if (res.ok) toast.success('SLA atualizado');
          else toast.error(res.error);
        })
      }
    >
      <Input
        name="sla"
        type="number"
        min={1}
        defaultValue={sla ?? ''}
        placeholder={`${defaultSla} (padrão)`}
        className="w-32 sm:h-8 sm:text-xs"
        aria-label="SLA em minutos"
      />
      <span className="text-xs text-muted">min</span>
      <Button size="sm" variant="secondary" disabled={pending}>
        Salvar
      </Button>
    </form>
  );
}

export function MarkTeamButton({ jid, name, phone }: { jid: string; name: string; phone: string | null }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-[11px] text-muted underline-offset-2 hover:text-brand hover:underline disabled:opacity-50"
      onClick={() => {
        const finalName = window.prompt('Marcar este remetente como membro da equipe. Nome:', name);
        if (!finalName) return;
        start(async () => {
          const res = await markSenderAsTeam(jid, finalName, phone);
          if (res.ok) toast.success(`${finalName} agora conta como equipe`);
          else toast.error(res.error);
        });
      }}
    >
      é da equipe?
    </button>
  );
}

/** Atualiza a conversa quando chega mensagem nova no grupo. */
export function LiveMessages({ groupId }: { groupId: string }) {
  const router = useRouter();
  useRealtime(`group-${groupId}`, (channel) =>
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
      () => router.refresh(),
    ),
  );
  return null;
}
