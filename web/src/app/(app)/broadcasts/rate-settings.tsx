'use client';

import { Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Field, Input } from '@/components/ui';
import type { BroadcastSettingsValues } from '@/lib/broadcast';
import { saveBroadcastSettings } from './actions';

/** Ritmo de envio da empresa: protege o número do WhatsApp contra bloqueio por envio em massa. */
export function RateSettings({ initial }: { initial: BroadcastSettingsValues }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = (k: keyof BroadcastSettingsValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });

  const save = () =>
    start(async () => {
      const r = await saveBroadcastSettings(v);
      if (r.ok) toast.success('Ritmo de envio salvo.');
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader
        title="Ritmo de envio"
        description="Enviar muitas mensagens rápido pode bloquear o número. O sistema espera um tempo aleatório entre as mensagens, faz uma pausa a cada lote e respeita o limite de 24 horas por número."
      />
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
        <Field label="Intervalo mínimo (s)" hint="Entre uma mensagem e outra.">
          <Input type="number" min={3} value={v.minDelayS} onChange={set('minDelayS')} />
        </Field>
        <Field label="Intervalo máximo (s)">
          <Input type="number" min={3} value={v.maxDelayS} onChange={set('maxDelayS')} />
        </Field>
        <Field label="Mensagens por lote" hint="Depois de cada lote há uma pausa.">
          <Input type="number" min={5} value={v.batchSize} onChange={set('batchSize')} />
        </Field>
        <Field label="Pausa entre lotes (min)">
          <Input type="number" min={1} value={v.batchPauseMin} onChange={set('batchPauseMin')} />
        </Field>
        <Field label="Limite em 24 h" hint="Por número do WhatsApp.">
          <Input type="number" min={1} value={v.dailyLimit} onChange={set('dailyLimit')} />
        </Field>
      </div>
      <div className="flex justify-end px-4 pb-4 sm:px-5 sm:pb-5">
        <Button onClick={save} disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? 'Salvando…' : 'Salvar ritmo'}
        </Button>
      </div>
    </Card>
  );
}
