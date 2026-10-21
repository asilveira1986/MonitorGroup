'use client';

import { PackageCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { updateDemand } from '@/app/(app)/demands/actions';
import { Button, Select } from '@/components/ui';

/** Só o responsável vê: marca a demanda como entregue. */
export function DeliverButton({ id, number }: { id: string; number: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Confirmar a entrega da demanda #${number}?`)) return;
        start(async () => {
          const res = await updateDemand(id, { status: 'entregue' });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Demanda #${number} entregue`);
          router.refresh();
        });
      }}
    >
      <PackageCheck className="h-3.5 w-3.5" /> Demanda entregue
    </Button>
  );
}

/** Administrador: de quem é a agenda mostrada. */
export function PersonSelect({ value, mine, people }: { value: string; mine: boolean; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <Select
      value={value}
      aria-label="Agenda de"
      className="h-9 w-56 text-sm"
      onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set('pessoa', e.target.value);
        else next.delete('pessoa');
        next.delete('dia');
        router.push(`/agenda${next.size ? `?${next}` : ''}`);
      }}
    >
      <option value="">{mine ? 'Minha agenda' : 'Escolha uma pessoa'}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
