'use client';

import { BellRing, Eye, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, Textarea, Toggle } from '@/components/ui';
import { cn, timeAgo } from '@/lib/format';
import type { BlockConfig, IndicatorConfig, ParamField } from '@/lib/indicators';
import { resetIndicators, setIndicatorBlockEnabled, updateIndicator } from '../actions';

type Category = { name: string; keywords: string[] };

const splitList = (text: string) =>
  text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Campo de lista separada por vírgula: edita como texto livre e converte para lista. */
function ListInput({
  value,
  onChange,
  disabled,
  placeholder,
  multiline,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value.join(', '));
  const props = {
    value: text,
    disabled,
    placeholder,
    className,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      onChange(splitList(e.target.value));
    },
  };
  return multiline ? <Textarea rows={2} {...props} /> : <Input {...props} />;
}

function ParamInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  if (field.type === 'int') {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={field.min}
          max={field.max}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={disabled}
          className="w-32"
        />
        {field.unit && <span className="text-sm text-muted">{field.unit}</span>}
      </div>
    );
  }
  if (field.type === 'tags') {
    return (
      <ListInput
        multiline
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        disabled={disabled}
        placeholder="Separe por vírgula"
      />
    );
  }
  // categories
  const cats = Array.isArray(value) ? (value as Category[]) : [];
  const set = (i: number, c: Category) => onChange(cats.map((x, j) => (j === i ? c : x)));
  return (
    <div className="space-y-2">
      {cats.map((c, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-line p-2 sm:flex-row sm:items-center">
          <Input
            value={c.name}
            onChange={(e) => set(i, { ...c, name: e.target.value })}
            disabled={disabled}
            placeholder="Categoria"
            className="sm:w-40"
          />
          <ListInput
            value={c.keywords}
            onChange={(keywords) => set(i, { ...c, keywords })}
            disabled={disabled}
            placeholder="palavras-chave, separadas por vírgula"
            className="flex-1"
          />
          <button
            type="button"
            className="self-end rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-critical-ink sm:self-auto"
            onClick={() => onChange(cats.filter((_, j) => j !== i))}
            disabled={disabled}
            aria-label="Remover categoria"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange([...cats, { name: '', keywords: [] }])}
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar categoria
      </Button>
    </div>
  );
}

function IndicatorRow({
  indicator,
  blockEnabled,
  people,
}: {
  indicator: IndicatorConfig;
  blockEnabled: boolean;
  people: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  // o componente é recriado (key) quando o servidor devolve uma versão nova do indicador
  const [params, setParams] = useState(indicator.params);
  const dirty = JSON.stringify(params) !== JSON.stringify(indicator.params);
  const isDefault =
    indicator.enabled === indicator.default_enabled &&
    indicator.alert_enabled === indicator.default_alert_enabled &&
    JSON.stringify(indicator.params) === JSON.stringify(indicator.default_params);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else toast.success(ok);
    });

  return (
    <li className={cn('py-4', (!blockEnabled || !indicator.enabled) && 'opacity-70')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{indicator.name}</p>
          {indicator.description && <p className="mt-0.5 text-sm text-ink-2">{indicator.description}</p>}
          <p className="mt-1 text-xs text-muted">
            <code>{indicator.key}</code>
            {indicator.updated_by && ` · alterado por ${people[indicator.updated_by] ?? 'admin'} ${timeAgo(indicator.updated_at)}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle
            checked={indicator.enabled}
            disabled={pending}
            onChange={(v) => run(() => updateIndicator(indicator.key, { enabled: v }), v ? 'Indicador exibido' : 'Indicador oculto')}
            label={
              <span className="inline-flex items-center gap-1.5 text-sm">
                <Eye className="h-4 w-4 text-muted" /> Exibir
              </span>
            }
          />
          {indicator.supports_alert && (
            <Toggle
              checked={indicator.alert_enabled}
              disabled={pending}
              onChange={(v) =>
                run(() => updateIndicator(indicator.key, { alert_enabled: v }), v ? 'Alerta ligado' : 'Alerta desligado')
              }
              label={
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <BellRing className="h-4 w-4 text-muted" /> Alertar
                </span>
              }
            />
          )}
        </div>
      </div>

      {indicator.param_schema.length > 0 && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3 sm:p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {indicator.param_schema.map((field) => (
              <div key={field.key} className={cn('space-y-1.5', field.type !== 'int' && 'sm:col-span-2')}>
                <span className="text-xs font-medium text-ink-2">{field.label}</span>
                <ParamInput
                  field={field}
                  value={params[field.key]}
                  disabled={pending}
                  onChange={(v) => setParams((prev) => ({ ...prev, [field.key]: v }))}
                />
                {field.help && <span className="block text-xs text-muted">{field.help}</span>}
              </div>
            ))}
          </div>
          {dirty && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => updateIndicator(indicator.key, { params }), 'Parâmetros salvos')}
              >
                <Save className="h-3.5 w-3.5" /> Salvar parâmetros
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setParams(indicator.params)}>
                Descartar
              </Button>
            </div>
          )}
        </div>
      )}

      {!isDefault && (
        <button
          className="mt-2 inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
          disabled={pending}
          onClick={() => run(() => resetIndicators(indicator.key), 'Padrão restaurado')}
        >
          <RotateCcw className="h-3 w-3" /> Restaurar padrão deste indicador
        </button>
      )}
    </li>
  );
}

export function IndicatorsPanel({
  blocks,
  indicators,
  people,
}: {
  blocks: BlockConfig[];
  indicators: IndicatorConfig[];
  people: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const visibleBlocks = blocks.filter((b) => indicators.some((i) => i.block_key === b.key));
  const activeCount = indicators.filter(
    (i) => i.enabled && blocks.find((b) => b.key === i.block_key)?.enabled,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-2">
          {activeCount} de {indicators.length} indicadores aparecem no dashboard. Desligar um indicador não apaga dados:
          ao religar, o histórico do período volta completo.
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!confirm('Restaurar todos os indicadores e blocos para o padrão? Parâmetros personalizados serão perdidos.'))
              return;
            start(async () => {
              const res = await resetIndicators(null);
              if (res.ok) toast.success('Padrão restaurado');
              else toast.error(res.error);
            });
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão
        </Button>
      </div>

      {visibleBlocks.map((block) => {
        const items = indicators.filter((i) => i.block_key === block.key);
        const on = items.filter((i) => i.enabled).length;
        return (
          <Card key={block.key}>
            <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{block.name}</h3>
                  <Badge tone={block.enabled ? 'good' : 'neutral'}>
                    {block.enabled ? `${on} de ${items.length} ativos` : 'Bloco desligado'}
                  </Badge>
                </div>
                {block.description && <p className="mt-0.5 text-sm text-ink-2">{block.description}</p>}
              </div>
              <Toggle
                checked={block.enabled}
                disabled={pending}
                label="Bloco inteiro"
                onChange={(v) =>
                  start(async () => {
                    const res = await setIndicatorBlockEnabled(block.key, v);
                    if (res.ok) toast.success(v ? 'Bloco ligado' : 'Bloco desligado');
                    else toast.error(res.error);
                  })
                }
              />
            </div>
            <ul className="divide-y divide-line px-4 sm:px-5">
              {items.map((i) => (
                <IndicatorRow key={`${i.key}-${i.updated_at}`} indicator={i} blockEnabled={block.enabled} people={people} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
