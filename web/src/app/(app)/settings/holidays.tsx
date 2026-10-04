'use client';

import { CalendarOff } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/form-action';
import { Button, Card, CardHeader, Field, Input } from '@/components/ui';
import { addHoliday, removeHoliday } from './actions';

const fmt = (day: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

export function Holidays({ holidays, isAdmin }: { holidays: { day: string; name: string }[]; isAdmin: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Feriados"
        description="Dias fora do expediente, usados nos indicadores de tempo e nos alertas de horário comercial."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {isAdmin && <HolidayForm />}
        {holidays.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CalendarOff className="h-4 w-4" /> Nenhum feriado cadastrado.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {holidays.map((h) => (
              <li key={h.day} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  <span className="tabular text-ink-2">{fmt(h.day)}</span> · {h.name}
                </span>
                {isAdmin && (
                  <ActionButton variant="ghost" action={removeHoliday.bind(null, h.day)} success="Feriado removido">
                    Remover
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function HolidayForm() {
  return (
    <ActionForm action={addHoliday} success="Feriado adicionado" resetOnSuccess className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
      {(pending) => (
        <>
          <Field label="Data">
            <Input type="date" name="day" required />
          </Field>
          <Field label="Nome">
            <Input name="name" required placeholder="Ex.: Natal" />
          </Field>
          <Button disabled={pending}>Adicionar</Button>
        </>
      )}
    </ActionForm>
  );
}
