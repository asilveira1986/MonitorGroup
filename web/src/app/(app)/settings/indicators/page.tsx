import { History } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { BlockConfig, IndicatorConfig } from '@/lib/indicators';
import { createClient } from '@/lib/supabase/server';
import { IndicatorsPanel } from './panel';

type AuditRow = {
  id: number;
  table_name: string;
  record_key: string;
  changed_fields: string[];
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
};

const show = (v: unknown) => (v === undefined || v === null ? '—' : JSON.stringify(v));

const FIELD_LABEL: Record<string, string> = {
  enabled: 'exibição',
  alert_enabled: 'alerta',
  params: 'parâmetros',
  default_sla_minutes: 'SLA padrão',
  business_days: 'dias úteis',
  business_start: 'início do expediente',
  business_end: 'fim do expediente',
  timezone: 'fuso horário',
};

function describeChange(a: AuditRow, names: Map<string, string>) {
  if (a.changed_fields.includes('insert')) return `adicionou ${a.record_key}`;
  if (a.changed_fields.includes('delete')) return `removeu ${a.record_key}`;
  const parts = a.changed_fields.map((f) => {
    const before = a.old_values?.[f];
    const after = a.new_values?.[f];
    if (typeof after === 'boolean') return `${FIELD_LABEL[f] ?? f} ${after ? 'ligado' : 'desligado'}`;
    if (f === 'params') {
      const b = (before ?? {}) as Record<string, unknown>;
      const n = (after ?? {}) as Record<string, unknown>;
      const diffs = Object.keys(n).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(n[k]));
      return diffs.map((k) => `${k}: ${show(b[k])} → ${show(n[k])}`).join(', ');
    }
    return `${FIELD_LABEL[f] ?? f}: ${show(before)} → ${show(after)}`;
  });
  return `${names.get(a.record_key) ?? a.record_key} — ${parts.join('; ')}`;
}

export default async function IndicatorsSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: blocks }, { data: indicators }, { data: profiles }, { data: audit }, { data: settings }, { count: holidays }] = await Promise.all([
    supabase.from('indicator_blocks').select('*').order('position'),
    supabase.from('indicators').select('*').order('position'),
    supabase.from('profiles').select('id, full_name, email'),
    supabase
      .from('config_audit')
      .select('*')
      .in('table_name', ['indicators', 'indicator_blocks', 'app_settings', 'holidays'])
      .order('changed_at', { ascending: false })
      .limit(30),
    supabase.from('app_settings').select('business_days, business_start, business_end').eq('id', 1).single(),
    supabase.from('holidays').select('day', { count: 'exact', head: true }),
  ]);

  const people = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const names = new Map<string, string>([
    ...((indicators ?? []) as IndicatorConfig[]).map((i) => [i.key, i.name] as [string, string]),
    ...((blocks ?? []) as BlockConfig[]).map((b) => [b.key, `Bloco ${b.name}`] as [string, string]),
    ['1', 'Configurações gerais'],
  ]);

  return (
    <div className="space-y-4">
      <IndicatorsPanel
        blocks={(blocks ?? []) as BlockConfig[]}
        indicators={(indicators ?? []) as IndicatorConfig[]}
        people={people}
        businessHours={{
          days: settings?.business_days ?? [1, 2, 3, 4, 5],
          start: settings?.business_start ?? '08:00',
          end: settings?.business_end ?? '18:00',
          holidays: holidays ?? 0,
        }}
      />

      <Card>
        <CardHeader title="Histórico de alterações" description="Quem alterou as configurações e quando (últimas 30)." />
        <ul className="divide-y divide-line px-4 pb-3 pt-2 sm:px-5">
          {((audit ?? []) as AuditRow[]).length === 0 && <li className="py-3 text-sm text-muted">Nenhuma alteração ainda.</li>}
          {((audit ?? []) as AuditRow[]).map((a) => (
            <li key={a.id} className="flex gap-3 py-2.5 text-sm">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0">
                <p className="break-words">{describeChange(a, names)}</p>
                <p className="text-xs text-muted">
                  {(a.changed_by && people[a.changed_by]) || 'Sistema'} · {formatDateTime(a.changed_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
