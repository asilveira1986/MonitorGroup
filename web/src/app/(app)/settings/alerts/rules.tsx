'use client';

import { BellRing, Clock, KeyRound, Mail, MessageCircle, Pencil, Plus, Trash2, TrendingUp, Webhook, WifiOff, Moon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionForm } from '@/components/form-action';
import { Badge, Button, Card, EmptyState, Field, Input, Select, SeverityBadge, Textarea, Toggle } from '@/components/ui';
import { ALERT_TYPE_LABEL } from '@/lib/format';
import type { AlertRule, AlertType } from '@/lib/types';
import { deleteAlertRule, saveAlertRule, toggleAlertRule } from '../actions';

const TYPE_INFO: Record<AlertType, { icon: typeof Clock; help: string }> = {
  no_response: { icon: Clock, help: 'Dispara quando um cliente fica sem resposta por mais tempo que o limite.' },
  keyword: { icon: KeyRound, help: 'Dispara na hora quando um cliente escreve uma das palavras-chave.' },
  high_volume: { icon: TrendingUp, help: 'Dispara quando um grupo recebe muitas mensagens de clientes em pouco tempo.' },
  inactivity: { icon: Moon, help: 'Dispara quando um grupo fica sem nenhuma mensagem por muito tempo.' },
  disconnected: { icon: WifiOff, help: 'Dispara quando o WhatsApp conectado cai e o monitoramento para.' },
};

function describe(rule: AlertRule) {
  switch (rule.type) {
    case 'no_response':
      return `Cliente sem resposta por ${rule.threshold_minutes} min`;
    case 'keyword':
      return `Palavras: ${(rule.keywords ?? []).join(', ')}`;
    case 'high_volume':
      return `${rule.threshold_count} mensagens em ${rule.threshold_minutes} min`;
    case 'inactivity':
      return `Sem mensagens por ${rule.threshold_minutes} min`;
    case 'disconnected':
      return 'Conexão do WhatsApp caiu';
  }
}

function RuleEditor({
  rule,
  groups,
  onClose,
}: {
  rule: Partial<AlertRule> | null;
  groups: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [type, setType] = useState<AlertType>(rule?.type ?? 'no_response');
  const needsMinutes = type === 'no_response' || type === 'inactivity' || type === 'high_volume';

  return (
    <Card className="border-brand/40 p-5">
      <ActionForm action={saveAlertRule} success="Regra salva" onDone={onClose} className="space-y-5">
        {(pending) => (
          <>
            <input type="hidden" name="id" value={rule?.id ?? ''} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nome da regra">
                <Input name="name" required defaultValue={rule?.name ?? ''} placeholder="Ex.: Cliente esperando 30 min" />
              </Field>
              <Field label="Tipo">
                <Select name="type" value={type} onChange={(e) => setType(e.target.value as AlertType)}>
                  {Object.keys(TYPE_INFO).map((t) => (
                    <option key={t} value={t}>
                      {ALERT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Gravidade">
                <Select name="severity" defaultValue={rule?.severity ?? 'warning'}>
                  <option value="info">Informativo</option>
                  <option value="warning">Atenção</option>
                  <option value="critical">Crítico</option>
                </Select>
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted">{TYPE_INFO[type].help}</p>

            <div className="grid gap-4 sm:grid-cols-3">
              {needsMinutes && (
                <Field label={type === 'high_volume' ? 'Janela de tempo (min)' : 'Tempo limite (min)'}>
                  <Input type="number" min={1} name="threshold_minutes" required defaultValue={rule?.threshold_minutes ?? 30} />
                </Field>
              )}
              {type === 'high_volume' && (
                <Field label="Quantidade de mensagens">
                  <Input type="number" min={1} name="threshold_count" required defaultValue={rule?.threshold_count ?? 20} />
                </Field>
              )}
              {(type === 'keyword' || type === 'high_volume' || type === 'disconnected') && (
                <Field label="Intervalo mínimo entre alertas (min)" hint="Evita alertas repetidos.">
                  <Input type="number" min={1} name="cooldown_minutes" defaultValue={rule?.cooldown_minutes ?? 60} />
                </Field>
              )}
            </div>

            {type === 'keyword' && (
              <Field label="Palavras-chave" hint="Separe por vírgula ou uma por linha. Acentos e maiúsculas são ignorados.">
                <Textarea name="keywords" rows={2} defaultValue={(rule?.keywords ?? []).join(', ')} placeholder="urgente, cancelar, reclamação" />
              </Field>
            )}

            {type !== 'disconnected' && (
              <Field label="Grupos" hint="Nenhum selecionado = todos os grupos monitorados. Use Ctrl/⌘ para selecionar vários.">
                <Select name="group_ids" multiple defaultValue={rule?.group_ids ?? []} className="h-28 py-2">
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="rounded-xl bg-surface-2 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <BellRing className="h-4 w-4" /> Como avisar
              </p>
              <p className="mb-3 text-xs text-muted">O alerta sempre aparece no painel. Adicione outros canais se quiser:</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="E-mails" hint="Separados por vírgula">
                  <Input name="notify_emails" defaultValue={(rule?.notify_emails ?? []).join(', ')} placeholder="gestor@empresa.com" />
                </Field>
                <Field label="WhatsApp" hint="Números com DDI+DDD, separados por vírgula">
                  <Input name="notify_whatsapp" defaultValue={(rule?.notify_whatsapp ?? []).join(', ')} placeholder="5511999998888" />
                </Field>
                <Field label="Webhook (Slack, Teams, n8n…)" hint="Recebe um POST JSON">
                  <Input name="notify_webhook_url" type="url" defaultValue={rule?.notify_webhook_url ?? ''} placeholder="https://hooks.slack.com/…" />
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap gap-6">
              <Toggle name="active" defaultChecked={rule?.active ?? true} label="Regra ativa" />
              {type !== 'disconnected' && (
                <Toggle name="business_hours_only" defaultChecked={rule?.business_hours_only ?? false} label="Somente no horário comercial" />
              )}
            </div>

            <div className="flex gap-2">
              <Button disabled={pending}>{pending ? 'Salvando…' : 'Salvar regra'}</Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </ActionForm>
    </Card>
  );
}

export function RulesPanel({
  rules,
  groups,
  isAdmin,
}: {
  rules: AlertRule[];
  groups: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<Partial<AlertRule> | null | undefined>(undefined);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else if (ok) toast.success(ok);
    });

  return (
    <div className="space-y-4">
      {isAdmin && editing === undefined && (
        <Button onClick={() => setEditing(null)}>
          <Plus className="h-4 w-4" /> Nova regra
        </Button>
      )}
      {editing !== undefined && (
        <RuleEditor key={editing?.id ?? 'new'} rule={editing} groups={groups} onClose={() => setEditing(undefined)} />
      )}

      {rules.length === 0 && (
        <Card>
          <EmptyState icon={<BellRing />} title="Nenhuma regra de alerta" description="Crie regras para ser avisado quando um cliente ficar sem resposta." />
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rules.map((rule) => {
          const Icon = TYPE_INFO[rule.type].icon;
          return (
            <Card key={rule.id} className={`p-4 ${rule.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{rule.name}</p>
                    <SeverityBadge severity={rule.severity} />
                  </div>
                  <p className="mt-0.5 text-sm text-ink-2">{describe(rule)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge>{rule.group_ids?.length ? `${rule.group_ids.length} grupo(s)` : 'Todos os grupos'}</Badge>
                    {rule.business_hours_only && <Badge>Horário comercial</Badge>}
                    {rule.notify_emails.length > 0 && (
                      <Badge tone="info">
                        <Mail className="h-3 w-3" /> {rule.notify_emails.length}
                      </Badge>
                    )}
                    {rule.notify_whatsapp.length > 0 && (
                      <Badge tone="good">
                        <MessageCircle className="h-3 w-3" /> {rule.notify_whatsapp.length}
                      </Badge>
                    )}
                    {rule.notify_webhook_url && (
                      <Badge>
                        <Webhook className="h-3 w-3" /> webhook
                      </Badge>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Toggle
                      checked={rule.active}
                      disabled={pending}
                      onChange={(v) => run(() => toggleAlertRule(rule.id, v))}
                    />
                    <div className="flex">
                      <button
                        className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2"
                        onClick={() => setEditing(rule)}
                        aria-label="Editar regra"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 hover:text-critical-ink"
                        onClick={() => confirm('Excluir esta regra?') && run(() => deleteAlertRule(rule.id), 'Regra excluída')}
                        aria-label="Excluir regra"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
