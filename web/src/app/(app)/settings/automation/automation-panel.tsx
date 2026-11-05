'use client';

import { BellRing, CheckCheck, Clock, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { formatDuration, timeAgo } from '@/lib/format';
import { deleteAutomationRule, resolveAutomationPending, saveAutomationRule, setAutomationEnabled } from './actions';

export type RuleItem = {
  id: string;
  group_id: string;
  enabled: boolean;
  ack_enabled: boolean;
  ack_message: string;
  ack_off_hours: string;
  ack_cooldown_min: number;
  notify_group_jid: string;
  notify_group_name: string;
  escalate_after_min: number;
  repeat_every_min: number;
  max_escalations: number;
  escalate_off_hours: boolean;
  mention_jids: string[];
  business_days: number[];
  business_start: string;
  business_end: string;
  groups: { name: string } | null;
};

export type PendingItem = {
  id: string;
  group_id: string;
  client_name: string | null;
  preview: string;
  message_count: number;
  received_at: string;
  escalation_count: number;
  groups: { name: string } | null;
};

export type AutomationMetrics = {
  days: number;
  resolved: number;
  open: number;
  avg_response_sec: number | null;
  median_response_sec: number | null;
  escalated: number;
};

export type MemberOption = { id: string; name: string; jid: string };
type GroupOption = { id: string; name: string; jid: string };

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DEFAULT_ACK = '✅ Recebemos sua mensagem! Nossa equipe já foi avisada e retorna em breve.';
const DEFAULT_ACK_OFF =
  '✅ Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Retornaremos no próximo horário útil.';

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="tabular mt-0.5 text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/** Formulário de uma regra: criação (escolhe o grupo do cliente) ou edição. */
function RuleForm({
  rule,
  groups,
  members,
  takenGroupIds,
  onClose,
}: {
  rule: RuleItem | null;
  groups: GroupOption[];
  members: MemberOption[];
  takenGroupIds: Set<string>;
  onClose: () => void;
}) {
  const [groupId, setGroupId] = useState(rule?.group_id ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [ackEnabled, setAckEnabled] = useState(rule?.ack_enabled ?? true);
  const [ackMessage, setAckMessage] = useState(rule?.ack_message ?? DEFAULT_ACK);
  const [ackOffHours, setAckOffHours] = useState(rule?.ack_off_hours ?? DEFAULT_ACK_OFF);
  const [ackCooldown, setAckCooldown] = useState(String(rule?.ack_cooldown_min ?? 30));
  const [notifyJid, setNotifyJid] = useState(rule?.notify_group_jid ?? '');
  const [escalateAfter, setEscalateAfter] = useState(String(rule?.escalate_after_min ?? 15));
  const [repeatEvery, setRepeatEvery] = useState(String(rule?.repeat_every_min ?? 30));
  const [maxEscalations, setMaxEscalations] = useState(String(rule?.max_escalations ?? 3));
  const [escalateOffHours, setEscalateOffHours] = useState(rule?.escalate_off_hours ?? false);
  const [mentions, setMentions] = useState<Set<string>>(new Set(rule?.mention_jids ?? []));
  const [days, setDays] = useState<Set<number>>(new Set(rule?.business_days ?? [1, 2, 3, 4, 5]));
  const [start, setStart] = useState(rule?.business_start ?? '08:00');
  const [end, setEnd] = useState(rule?.business_end ?? '18:00');
  const [pending, startTransition] = useTransition();

  const available = groups.filter((g) => !takenGroupIds.has(g.id) || g.id === rule?.group_id);
  const notifyOptions = groups.filter((g) => g.id !== groupId);
  const toggleIn = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const save = () =>
    startTransition(async () => {
      if (!groupId) return void toast.error('Escolha o grupo do cliente.');
      const notify = groups.find((g) => g.jid === notifyJid);
      const res = await saveAutomationRule(groupId, {
        enabled,
        ackEnabled,
        ackMessage,
        ackOffHours,
        ackCooldownMin: ackCooldown,
        notifyGroupJid: notifyJid,
        notifyGroupName: notify?.name ?? rule?.notify_group_name ?? 'Grupo interno',
        escalateAfterMin: escalateAfter,
        repeatEveryMin: repeatEvery,
        maxEscalations,
        escalateOffHours,
        mentionJids: [...mentions],
        businessDays: [...days],
        businessStart: start,
        businessEnd: end,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(rule ? 'Regra salva' : 'Regra criada');
      onClose();
    });

  return (
    <Card>
      <CardHeader
        title={rule ? `Regra: ${rule.groups?.name ?? 'grupo'}` : 'Nova regra de automação'}
        description="A automação age nas mensagens novas dos clientes neste grupo. Quem responde no grupo (equipe ou o número conectado) encerra a demanda."
        action={
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar o formulário">
            <X className="h-4 w-4" />
          </Button>
        }
      />
      <div className="space-y-5 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Grupo do cliente">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={Boolean(rule) || pending}>
              <option value="">Escolha o grupo</option>
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grupo interno (recebe o aviso e a cobrança)" hint="O número conectado precisa participar dele. Sugestão: deixe esse grupo sem monitoramento.">
            <Select value={notifyJid} onChange={(e) => setNotifyJid(e.target.value)} disabled={pending}>
              <option value="">Escolha o grupo interno</option>
              {notifyOptions.map((g) => (
                <option key={g.id} value={g.jid}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Toggle checked={enabled} onChange={setEnabled} disabled={pending} label={<span className="text-sm">Automação ligada neste grupo</span>} />
          <Toggle checked={ackEnabled} onChange={setAckEnabled} disabled={pending} label={<span className="text-sm">Responder com o acuse de recebimento</span>} />
          <Toggle checked={escalateOffHours} onChange={setEscalateOffHours} disabled={pending} label={<span className="text-sm">Cobrar também fora do horário de atendimento</span>} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Acuse dentro do horário de atendimento">
            <Textarea value={ackMessage} onChange={(e) => setAckMessage(e.target.value)} rows={3} maxLength={1000} disabled={pending || !ackEnabled} />
          </Field>
          <Field label="Acuse fora do horário de atendimento">
            <Textarea value={ackOffHours} onChange={(e) => setAckOffHours(e.target.value)} rows={3} maxLength={1000} disabled={pending || !ackEnabled} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Intervalo entre acuses (min)" hint="Não repete o acuse dentro deste tempo.">
            <Input type="number" min={0} inputMode="numeric" value={ackCooldown} onChange={(e) => setAckCooldown(e.target.value)} disabled={pending} />
          </Field>
          <Field label="Cobrar depois de (min)" hint="Sem resposta por este tempo.">
            <Input type="number" min={0} inputMode="numeric" value={escalateAfter} onChange={(e) => setEscalateAfter(e.target.value)} disabled={pending} />
          </Field>
          <Field label="Repetir a cada (min)">
            <Input type="number" min={0} inputMode="numeric" value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} disabled={pending} />
          </Field>
          <Field label="Máximo de cobranças">
            <Input type="number" min={0} inputMode="numeric" value={maxEscalations} onChange={(e) => setMaxEscalations(e.target.value)} disabled={pending} />
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-2">Horário de atendimento</p>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((label, d) => (
              <label key={label} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs has-[:checked]:border-brand-line has-[:checked]:bg-brand-soft">
                <input type="checkbox" className="sr-only" checked={days.has(d)} onChange={() => toggleIn(days, d, setDays)} disabled={pending} />
                {label}
              </label>
            ))}
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-28" disabled={pending} aria-label="Início do atendimento" />
            <span className="text-xs text-muted">até</span>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" disabled={pending} aria-label="Fim do atendimento" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-2">Quem é marcado na cobrança</p>
          {members.length === 0 ? (
            <p className="text-xs text-muted">Cadastre os atendentes com telefone em Configurações › Pessoas para poder marcá-los.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <label key={m.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs has-[:checked]:border-brand-line has-[:checked]:bg-brand-soft">
                  <input type="checkbox" className="sr-only" checked={mentions.has(m.jid)} onChange={() => toggleIn(mentions, m.jid, setMentions)} disabled={pending} />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending}>
            <Save className="h-4 w-4" /> {rule ? 'Salvar a regra' : 'Criar a regra'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function AutomationPanel({
  isAdmin,
  enabled,
  rules,
  pending,
  metrics,
  groups,
  members,
}: {
  isAdmin: boolean;
  /** chave geral da empresa (0145): desligada, a automação não age */
  enabled: boolean;
  rules: RuleItem[];
  pending: PendingItem[];
  metrics: AutomationMetrics | null;
  groups: GroupOption[];
  members: MemberOption[];
}) {
  const [on, setOn] = useState(enabled);
  const [editing, setEditing] = useState<RuleItem | 'new' | null>(null);
  const [busy, startTransition] = useTransition();
  const takenGroupIds = new Set(rules.map((r) => r.group_id));

  const toggleAll = (next: boolean) =>
    startTransition(async () => {
      const res = await setAutomationEnabled(next);
      if (!res.ok) return void toast.error(res.error);
      setOn(next);
      toast.success(next ? 'Automação de atendimento ligada' : 'Automação de atendimento desligada');
    });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else toast.success(ok);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <>
              <BellRing className="h-4 w-4" aria-hidden /> Automação de atendimento
            </>
          }
          description="Quando um cliente escreve num grupo com a automação ligada, o sistema responde com um acuse de recebimento, mostra o alerta na tela, avisa o grupo interno e cobra a equipe enquanto a mensagem ficar sem resposta. Uma mensagem da equipe no grupo encerra a demanda."
        />
        <div className="space-y-2 px-4 pt-3 sm:px-5">
          <Toggle
            checked={on}
            onChange={toggleAll}
            disabled={!isAdmin || busy}
            label={<span className="text-sm font-medium">{on ? 'Automação ligada' : 'Automação desligada'}</span>}
          />
          {!on && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-ink">
              Desligada: o sistema não responde aos clientes, não avisa o grupo interno nem cobra a equipe. As regras e as demandas abertas ficam guardadas, e uma resposta da equipe no grupo ainda encerra a demanda. Ligue quando quiser começar.
            </p>
          )}
          {on && rules.length === 0 && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">Ligada, mas ainda sem regras: crie a regra de um grupo abaixo para a automação começar a agir.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3 sm:grid-cols-5 sm:px-5 sm:pb-5">
          <Metric label="Demandas abertas" value={String(metrics?.open ?? pending.length)} />
          <Metric label={`Resolvidas (${metrics?.days ?? 30} dias)`} value={String(metrics?.resolved ?? 0)} />
          <Metric label="Tempo médio de resposta" value={metrics?.avg_response_sec != null ? formatDuration(metrics.avg_response_sec) : '—'} />
          <Metric label="Mediana" value={metrics?.median_response_sec != null ? formatDuration(metrics.median_response_sec) : '—'} />
          <Metric label="Precisaram de cobrança" value={String(metrics?.escalated ?? 0)} hint={`nos últimos ${metrics?.days ?? 30} dias`} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Demandas abertas" description="Mensagens de clientes que ainda não foram respondidas." />
        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
          {pending.length === 0 ? (
            <EmptyState icon={<CheckCheck />} title="Nenhuma demanda aberta" description="Tudo respondido por aqui." />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{p.groups?.name ?? 'Grupo'}</p>
                    <p className="truncate text-xs text-ink-2">
                      {p.client_name ? `${p.client_name}: ` : ''}
                      {p.preview || '[mensagem]'}
                      {p.message_count > 1 ? ` · ${p.message_count} mensagens` : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> {timeAgo(p.received_at)}
                  </span>
                  {p.escalation_count > 0 && <Badge tone="critical">{p.escalation_count} cobrança(s)</Badge>}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => resolveAutomationPending(p.id), 'Demanda encerrada')}
                    title="Encerra a demanda e tira o alerta da tela"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Encerrar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {editing && (
        <RuleForm
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          groups={groups}
          members={members}
          takenGroupIds={takenGroupIds}
          onClose={() => setEditing(null)}
        />
      )}

      <Card>
        <CardHeader
          title="Regras por grupo"
          description="A automação só age nos grupos que têm regra. O horário de atendimento, o acuse e os tempos de cobrança são de cada grupo."
          action={
            isAdmin && !editing ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" /> Nova regra
              </Button>
            ) : undefined
          }
        />
        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
          {rules.length === 0 ? (
            <EmptyState icon={<BellRing />} title="Nenhuma regra ainda" description="Crie uma regra para o primeiro grupo e escolha o grupo interno que recebe os avisos." />
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.groups?.name ?? 'Grupo'}</p>
                    <p className="truncate text-xs text-ink-2">
                      Avisa em {r.notify_group_name} · cobra depois de {r.escalate_after_min} min, a cada {r.repeat_every_min} min, até {r.max_escalations}x ·{' '}
                      atendimento {r.business_start}–{r.business_end}
                    </p>
                  </div>
                  <Toggle
                    checked={r.enabled}
                    disabled={!isAdmin || busy}
                    onChange={(on) => run(() => saveAutomationRule(r.group_id, { enabled: on }), on ? 'Automação ligada' : 'Automação desligada')}
                    label={<span className="text-xs">{r.enabled ? 'Ligada' : 'Desligada'}</span>}
                  />
                  {isAdmin && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Remover a regra deste grupo? A automação deixa de agir nele.')) run(() => deleteAutomationRule(r.group_id), 'Regra removida');
                        }}
                        aria-label="Remover a regra"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <p className="px-1 text-xs text-muted">
        O serviço do WhatsApp (worker) precisa estar sempre ligado para a automação funcionar. Os avisos aparecem na tela como os demais alertas, inclusive com o sistema em segundo plano.
      </p>
    </div>
  );
}
