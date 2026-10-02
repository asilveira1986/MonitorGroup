'use client';

import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select, Toggle } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { saveGeneralSettings } from './actions';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'UTC',
];

export function GeneralForm({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  return (
    <ActionForm action={saveGeneralSettings} className="space-y-6">
      {(pending) => (
        <fieldset disabled={disabled || pending} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da empresa">
              <Input name="company_name" defaultValue={settings.company_name} />
            </Field>
            <Field label="Fuso horário">
              <Select name="timezone" defaultValue={settings.timezone}>
                {TIMEZONES.map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-2">Dias de atendimento</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <label key={d} className="cursor-pointer">
                  <input
                    type="checkbox"
                    name="business_days"
                    value={i}
                    defaultChecked={settings.business_days.includes(i)}
                    className="peer sr-only"
                  />
                  <span className="inline-flex h-9 w-12 items-center justify-center rounded-xl border border-line text-sm text-ink-2 transition peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand">
                    {d}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Início do expediente">
              <Input type="time" name="business_start" defaultValue={settings.business_start.slice(0, 5)} />
            </Field>
            <Field label="Fim do expediente">
              <Input type="time" name="business_end" defaultValue={settings.business_end.slice(0, 5)} />
            </Field>
            <Field label="SLA padrão de resposta (min)" hint="Pode ser ajustado por grupo.">
              <Input type="number" min={1} name="default_sla_minutes" defaultValue={settings.default_sla_minutes} />
            </Field>
          </div>

          <div className="space-y-3">
            <Toggle
              name="auto_monitor_new_groups"
              defaultChecked={settings.auto_monitor_new_groups}
              label="Monitorar automaticamente novos grupos"
            />
            <Toggle
              name="ignore_acknowledgements"
              defaultChecked={settings.ignore_acknowledgements}
              label='Ignorar agradecimentos ("ok", "obrigado", 👍) após a resposta da equipe'
            />
          </div>

          {!disabled && (
            <Button disabled={pending}>{pending ? 'Salvando…' : 'Salvar configurações'}</Button>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
