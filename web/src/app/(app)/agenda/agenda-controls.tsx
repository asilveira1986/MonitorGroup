'use client';

import { DeliverButton as SharedDeliverButton } from '@/components/demands/deliver-button';

/** "Demanda entregue" com observação para o cliente (componente das demandas). */
export function DeliverButton({ id, number }: { id: string; number: number }) {
  return <SharedDeliverButton id={id} number={number} size="sm" />;
}
