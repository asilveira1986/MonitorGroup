'use client';

import { Moon, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';
import { saveAfterHoursAlertGroup } from '../actions';

/**
 * Grupo de alertas fora do expediente (0139): quando o tempo de resposta (SLA) de um grupo estoura fora
 * do horário de trabalho, o sistema avisa neste grupo do WhatsApp.
 */
export function AfterHoursGroup({
  groups,
  current,
  currentMinutes,
  isAdmin,
}: {
  groups: { id: string; name: string }[];
  current: string | null;
  currentMinutes: number | null;
  isAdmin: boolean;
}) {
  const [value, setValue] = useState(current ?? '');
  const [minutes, setMinutes] = useState(currentMinutes ? String(currentMinutes) : '');
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveAfterHoursAlertGroup(value || null, minutes.trim() ? Number(minutes) : null);
      if (!res.ok) toast.error(res.error);
      else toast.success(value ? 'Grupo de alertas salvo' : 'Aviso fora do expediente desligado');
    });
  return (
    <Card>
      <CardHeader
        title={
          <>
            <Moon className="h-4 w-4" aria-hidden /> Grupo de alertas fora do expediente
          </>
        }
        description="Quando um cliente fica sem resposta pelo tempo definido e esse prazo vence fora do horário de trabalho, o sistema avisa neste grupo do WhatsApp, uma vez por mensagem sem resposta."
      />
      <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <Field
          label="Grupo que recebe o aviso"
          hint="Crie um grupo no WhatsApp com a equipe de plantão e coloque o número conectado nele. O aviso vale quando o prazo vence fora dos dias e horários do expediente (ou em feriados), contando o tempo corrido desde a mensagem do cliente. Sugestão: deixe esse grupo sem monitoramento."
        >
          <Select value={value} onChange={(e) => setValue(e.target.value)} disabled={!isAdmin || pending} aria-label="Grupo de alertas">
            <option value="">Desligado</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Avisar com quantos minutos sem resposta" hint="Em branco, vale o SLA de cada grupo (o do grupo ou o padrão da empresa). Ex.: 15 avisa quando o cliente ficar 15 minutos sem resposta fora do expediente.">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="SLA do grupo"
            disabled={!isAdmin || pending}
            aria-label="Minutos sem resposta para avisar"
          />
        </Field>
        {isAdmin && (
          <Button onClick={save} disabled={pending || (value === (current ?? '') && minutes.trim() === (currentMinutes ? String(currentMinutes) : ''))}>
            <Save className="h-4 w-4" /> Salvar
          </Button>
        )}
      </div>
    </Card>
  );
}
