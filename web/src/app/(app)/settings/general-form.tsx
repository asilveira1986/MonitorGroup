'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select, Toggle } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { saveGeneralSettings, setAdminsResponsibleAll } from '@/app/(app)/settings/actions/company';

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

/** Administradores como responsáveis de todos os grupos (0162): salva na hora, fora do botão "Salvar configurações". */
function AdminsResponsibleToggle({ initial, disabled }: { initial: boolean; disabled: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <Toggle
        checked={on}
        disabled={disabled || pending}
        onChange={(checked) => {
          setOn(checked);
          start(async () => {
            const res = await setAdminsResponsibleAll(checked);
            if (res.ok) toast.success(checked ? 'Administradores são responsáveis de todos os grupos' : 'Administradores deixam de valer como responsáveis de todos os grupos');
            else {
              setOn(!checked);
              toast.error(res.error);
            }
          });
        }}
        label="Administradores são responsáveis por todos os grupos"
      />
      <p className="max-w-xl text-xs text-muted">
        Além dos responsáveis escolhidos em cada grupo, os administradores aparecem como responsáveis, o filtro de um administrador no Painel de grupos mostra todos os grupos e a cobrança da
        automação que marca &ldquo;os responsáveis do grupo&rdquo; também marca os administradores (com telefone cadastrado em Configurações › Pessoas). Salva na hora.
      </p>
    </div>
  );
}

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
                  <span className="inline-flex h-9 w-12 items-center justify-center rounded-xl border border-line text-sm text-ink-2 transition peer-checked:border-brand-line peer-checked:bg-brand-soft peer-checked:text-brand-text">
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
            <Field label="SLA padrão de resposta" hint="Definido no indicador “Respondidas dentro do SLA”.">
              <div className="flex h-11 items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm sm:h-10">
                <span>{settings.default_sla_minutes} min</span>
                {!disabled && (
                  <Link href="/settings/indicators" className="text-xs text-brand-text hover:underline">
                    alterar
                  </Link>
                )}
              </div>
            </Field>
          </div>

          <Field
            label="Importar histórico ao conectar o WhatsApp"
            hint="Ao ler o QR code, traz as mensagens anteriores dos grupos monitorados (só texto) e já calcula as métricas do período. Mais dias = mais espaço no banco."
          >
            <Select name="history_import_days" defaultValue={String(settings.history_import_days ?? 30)}>
              <option value="0">Não importar</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias (recomendado)</option>
              <option value="60">Últimos 60 dias</option>
              <option value="90">Últimos 90 dias</option>
            </Select>
          </Field>

          <div className="flex flex-col items-start gap-3">
            <Toggle
              name="auto_monitor_new_groups"
              defaultChecked={settings.auto_monitor_new_groups}
              label="Monitorar automaticamente novos grupos"
            />
            <AdminsResponsibleToggle initial={settings.admins_responsible_all === true} disabled={disabled} />
          </div>

          {!disabled && (
            <Button disabled={pending}>{pending ? 'Salvando…' : 'Salvar configurações'}</Button>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}
