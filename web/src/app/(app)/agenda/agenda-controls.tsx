'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { DeliverButton as SharedDeliverButton } from '@/components/demands/deliver-button';
import { Select } from '@/components/ui';

/** "Demanda entregue" com observação para o cliente (componente das demandas). */
export function DeliverButton({ id, number }: { id: string; number: number }) {
  return <SharedDeliverButton id={id} number={number} size="sm" />;
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
