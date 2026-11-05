'use client';

import { BellRing, CheckCheck, Clock, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { formatDuration, timeAgo } from '@/lib/format';
import {
  deleteAutomationRule,
  deleteAutomationRules,
  resolveAutomationPending,
  saveAutomationRule,
  saveAutomationRules,
  setAutomationEnabled,
  setAutomationRulesEnabled,
} from './actions';

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
  groups: { name: string; sector_id: string | null } | null;
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
type GroupOption = { id: string; name: string; jid: string; sector_id: string | null };
export type SectorOption = { id: string; name: string };

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

/** Nome do setor de um grupo (ou "Sem setor"). */
const sectorLabel = (sectors: SectorOption[], sectorId: string | null) => (sectorId ? (sectors.find((x) => x.id === sectorId)?.name ?? 'Setor') : 'Sem setor');

/**
 * Escolha dos grupos do cliente que recebem a regra: busca, atalhos por setor ("selecionar todos do setor") e
 * marcação grupo a grupo. Grupos internos (que recebem avisos) não entram na lista.
 */
function GroupPicker({
  groups,
  sectors,
  selected,
  onChange,
  takenGroupIds,
  excludeJids,
  disabled,
}: {
  groups: GroupOption[];
  sectors: SectorOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  takenGroupIds: Set<string>;
  excludeJids: Set<string>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const candidates = groups.filter((g) => !excludeJids.has(g.jid));
  const visible = candidates.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));
  // atalhos por setor (só os que têm grupos), com "Sem setor" por último
  const bySector = new Map<string | null, GroupOption[]>();
  for (const g of candidates) bySector.set(g.sector_id, [...(bySector.get(g.sector_id) ?? []), g]);
  const shortcuts = [...sectors.map((x) => x.id), null].filter((id) => bySector.has(id));

  const toggleMany = (items: GroupOption[]) => {
    const next = new Set(selected);
    const allIn = items.every((g) => next.has(g.id));
    for (const g of items) {
      if (allIn) next.delete(g.id);
      else next.add(g.id);
    }
    onChange(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-2">Selecionar todos:</span>
        {shortcuts.map((id) => {
          const items = bySector.get(id) ?? [];
          const all = items.length > 0 && items.every((g) => selected.has(g.id));
          return (
            <button
              key={id ?? 'none'}
              type="button"
              disabled={disabled}
              onClick={() => toggleMany(items)}
              aria-pressed={all}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${all ? 'border-brand-line bg-brand-soft text-brand-text' : 'border-line text-ink-2 hover:border-ink-2'}`}
            >
              {sectorLabel(sectors, id)} ({items.length})
            </button>
          );
        })}
        <button type="button" disabled={disabled} onClick={() => toggleMany(candidates)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-ink-2">
          Todos ({candidates.length})
        </button>
        <button type="button" disabled={disabled || selected.size === 0} onClick={() => onChange(new Set())} className="px-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Limpar
        </button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar grupo" className="pl-9" aria-label="Buscar grupo do cliente" disabled={disabled} />
      </div>
      <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {visible.length === 0 && <li className="px-3 py-3 text-xs text-muted">Nenhum grupo encontrado.</li>}
        {visible.map((g) => (
          <li key={g.id}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} disabled={disabled} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="min-w-0 flex-1 truncate text-ink">{g.name}</span>
              <span className="shrink-0 text-[11px] text-muted">{sectorLabel(sectors, g.sector_id)}</span>
              {takenGroupIds.has(g.id) && <Badge className="py-0 text-[10px]">já tem regra</Badge>}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-2">
        <strong>{selected.size}</strong> grupo(s) escolhido(s). Os que já têm regra serão atualizados com estes ajustes.
      </p>
    </div>
  );
}

/**
 * Formulário da regra. Criação: escolhe um ou vários grupos do cliente (por exemplo, todos os de um setor) e o
 * grupo interno que recebe os avisos deles. Edição: ajusta a regra de um ou de vários grupos de uma vez.
 */
function RuleForm({
  rule,
  editIds,
  groups,
  sectors,
  members,
  takenGroupIds,
  internalJids,
  onClose,
}: {
  /** regra usada como modelo dos campos (edição) */
  rule: RuleItem | null;
  /** grupos que a edição altera; null na criação */
  editIds: string[] | null;
  groups: GroupOption[];
  sectors: SectorOption[];
  members: MemberOption[];
  takenGroupIds: Set<string>;
  /** grupos que já são o grupo interno de alguma regra */
  internalJids: Set<string>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
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

  const creating = editIds === null;
  const targetIds = creating ? [...picked] : editIds;
  const targetSet = new Set(targetIds);
  // o grupo interno não pode ser um dos grupos que recebem a regra
  const notifyOptions = groups.filter((g) => !targetSet.has(g.id));
  const toggleIn = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const save = () =>
    startTransition(async () => {
      if (!targetIds.length) return void toast.error('Escolha ao menos um grupo do cliente.');
      if (!notifyJid) return void toast.error('Escolha o grupo interno que recebe os avisos.');
      const notify = groups.find((g) => g.jid === notifyJid);
      const res = await saveAutomationRules(targetIds, {
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
      const n = res.saved ?? targetIds.length;
      toast.success(creating ? `Regra aplicada a ${n} grupo(s)` : `Regra salva em ${n} grupo(s)`, {
        description: res.skipped ? `${res.skipped} grupo(s) ficaram de fora por já serem grupos internos.` : undefined,
      });
      onClose();
    });

  const remove = () => {
    const what = targetIds.length > 1 ? `as regras de ${targetIds.length} grupos` : `a regra de "${rule?.groups?.name ?? 'este grupo'}"`;
    if (!confirm(`Excluir ${what}? A automação deixa de agir ${targetIds.length > 1 ? 'nesses grupos' : 'neste grupo'} e as demandas abertas dele são encerradas.`)) return;
    startTransition(async () => {
      const res = await deleteAutomationRules(targetIds);
      if (!res.ok) return void toast.error(res.error);
      toast.success(targetIds.length > 1 ? 'Regras excluídas' : 'Regra excluída');
      onClose();
    });
  };

  const title = creating
    ? 'Nova regra de automação'
    : targetIds.length === 1
      ? `Regra: ${rule?.groups?.name ?? 'grupo'}`
      : `Editar ${targetIds.length} regras de uma vez`;

  return (
    <Card>
      <CardHeader
        title={title}
        description="Escolha os grupos do cliente e o grupo interno que recebe o aviso e a cobrança deles. Crie quantas regras quiser: por exemplo, um setor para cada grupo interno."
        action={
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar o formulário">
            <X className="h-4 w-4" />
          </Button>
        }
      />
      <div className="space-y-5 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        {creating ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Grupos do cliente</p>
            <GroupPicker
              groups={groups}
              sectors={sectors}
              selected={picked}
              onChange={setPicked}
              takenGroupIds={takenGroupIds}
              excludeJids={new Set([...internalJids, ...(notifyJid ? [notifyJid] : [])])}
              disabled={pending}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
            {targetIds.length === 1
              ? 'Os ajustes valem para este grupo.'
              : `Os ajustes abaixo valem para os ${targetIds.length} grupos escolhidos e substituem os ajustes atuais deles.`}
          </p>
        )}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={pending}>
            <Save className="h-4 w-4" /> {creating ? 'Criar a regra' : 'Salvar a regra'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          {!creating && (
            <Button variant="danger" className="ml-auto" onClick={remove} disabled={pending}>
              <Trash2 className="h-4 w-4" /> {targetIds.length > 1 ? `Excluir ${targetIds.length} regras` : 'Excluir regra'}
            </Button>
          )}
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
  sectors,
  members,
}: {
  isAdmin: boolean;
  /** chave geral da empresa (0145): desligada, a automação não age */
  enabled: boolean;
  rules: RuleItem[];
  pending: PendingItem[];
  metrics: AutomationMetrics | null;
  groups: GroupOption[];
  sectors: SectorOption[];
  members: MemberOption[];
}) {
  const [on, setOn] = useState(enabled);
  // 'new' = criar; lista de regras = editar uma ou várias de uma vez
  const [editing, setEditing] = useState<'new' | RuleItem[] | null>(null);
  // regras marcadas na lista (por grupo), para agir em lote
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const takenGroupIds = new Set(rules.map((r) => r.group_id));
  const internalJids = new Set(rules.map((r) => r.notify_group_jid));

  // regras agrupadas pelo setor do grupo do cliente
  const sections = [...sectors.map((x) => x.id), null]
    .map((id) => ({ id, label: sectorLabel(sectors, id), items: rules.filter((r) => (r.groups?.sector_id ?? null) === id) }))
    .filter((sec) => sec.items.length > 0);
  const selectedRules = rules.filter((r) => selected.has(r.group_id));
  const toggleSelect = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const toggleAll = (next: boolean) =>
    startTransition(async () => {
      const res = await setAutomationEnabled(next);
      if (!res.ok) return void toast.error(res.error);
      setOn(next);
      toast.success(next ? 'Automação de atendimento ligada' : 'Automação de atendimento desligada');
    });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, clearSelection = false) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(ok);
        if (clearSelection) setSelected(new Set());
      }
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
          key={editing === 'new' ? 'new' : editing.map((r) => r.group_id).join(',')}
          rule={editing === 'new' ? null : editing[0]}
          editIds={editing === 'new' ? null : editing.map((r) => r.group_id)}
          groups={groups}
          sectors={sectors}
          members={members}
          takenGroupIds={takenGroupIds}
          internalJids={internalJids}
          onClose={() => {
            setEditing(null);
            setSelected(new Set());
          }}
        />
      )}

      <Card>
        <CardHeader
          title="Regras por grupo"
          description="A automação só age nos grupos que têm regra. Crie quantas regras quiser: cada uma pode valer para vários grupos (por exemplo, todos de um setor) e mandar os avisos para um grupo interno diferente. Marque grupos na lista para ligar, desligar, editar ou excluir de uma vez."
          action={
            isAdmin && !editing ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" /> Nova regra
              </Button>
            ) : undefined
          }
        />
        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
          {isAdmin && selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-line bg-brand-soft/50 px-3 py-2 text-sm">
              <strong>{selected.size}</strong> grupo(s) marcado(s):
              <Button size="sm" variant="secondary" disabled={busy || Boolean(editing)} onClick={() => setEditing(selectedRules)}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => setAutomationRulesEnabled([...selected], true), 'Automação ligada nos grupos marcados', true)}
              >
                Ligar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => setAutomationRulesEnabled([...selected], false), 'Automação desligada nos grupos marcados', true)}
              >
                Desligar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Excluir a regra de ${selected.size} grupo(s)? A automação deixa de agir neles e as demandas abertas são encerradas.`)) {
                    run(() => deleteAutomationRules([...selected]), 'Regras excluídas', true);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </Button>
              <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                Limpar seleção
              </button>
            </div>
          )}
          {rules.length === 0 ? (
            <EmptyState icon={<BellRing />} title="Nenhuma regra ainda" description="Crie uma regra, escolha os grupos (ou todos de um setor) e o grupo interno que recebe os avisos." />
          ) : (
            <div className="space-y-4">
              {sections.map((sec) => {
                const ids = sec.items.map((r) => r.group_id);
                const allSelected = ids.every((id) => selected.has(id));
                const targets = [...new Set(sec.items.map((r) => r.notify_group_name))];
                return (
                  <section key={sec.id ?? 'none'}>
                    <div className="flex flex-wrap items-center gap-2 border-b border-line pb-1.5">
                      {isAdmin && (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleSelect(ids)}
                          className="h-4 w-4 accent-[var(--brand)]"
                          aria-label={`Marcar todos os grupos de ${sec.label}`}
                        />
                      )}
                      <h4 className="text-sm font-semibold text-ink">{sec.label}</h4>
                      <span className="text-xs text-muted">
                        {sec.items.length} grupo(s) · avisa em {targets.join(', ')}
                      </span>
                    </div>
                    <ul className="divide-y divide-line">
                      {sec.items.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                          {isAdmin && (
                            <input
                              type="checkbox"
                              checked={selected.has(r.group_id)}
                              onChange={() => toggleSelect([r.group_id])}
                              className="h-4 w-4 accent-[var(--brand)]"
                              aria-label={`Marcar ${r.groups?.name ?? 'grupo'}`}
                            />
                          )}
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
                            onChange={(next) => run(() => saveAutomationRule(r.group_id, { enabled: next }), next ? 'Automação ligada' : 'Automação desligada')}
                            label={<span className="text-xs">{r.enabled ? 'Ligada' : 'Desligada'}</span>}
                          />
                          {isAdmin && (
                            <>
                              <Button variant="secondary" size="sm" disabled={Boolean(editing)} onClick={() => setEditing([r])}>
                                <Pencil className="h-3.5 w-3.5" /> Editar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                title="Excluir a regra deste grupo"
                                onClick={() => {
                                  if (confirm(`Excluir a regra de "${r.groups?.name ?? 'este grupo'}"? A automação deixa de agir nele e a demanda aberta é encerrada.`)) {
                                    run(() => deleteAutomationRule(r.group_id), 'Regra excluída');
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Excluir
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <p className="px-1 text-xs text-muted">
        O serviço do WhatsApp (worker) precisa estar sempre ligado para a automação funcionar. Os avisos aparecem na tela como os demais alertas, inclusive com o sistema em segundo plano.
      </p>
    </div>
  );
}
