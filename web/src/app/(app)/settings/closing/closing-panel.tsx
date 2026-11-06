'use client';

import { ClipboardCheck, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { DEFAULT_OPTIONS, DEFAULT_QUESTION, MAX_OPTIONS, MIN_OPTIONS, emptyOption, type ClosingOptionValue } from '@/lib/closing-flows';
import { timeAgo } from '@/lib/format';
import { GroupPicker, type GroupOption, type SectorOption } from '../automation/automation-panel';
import { deleteClosingFlow, saveClosingFlow, setClosingFlowEnabled } from './actions';

export type ClosingFlowItem = {
  id: string;
  name: string;
  enabled: boolean;
  question: string;
  options: ClosingOptionValue[];
  group_ids: string[];
  delay_min: number;
  expire_hours: number;
  notify_group_jid: string | null;
  notify_group_name: string | null;
  mention_jids: string[];
};

export type SurveyItem = {
  id: string;
  status: 'scheduled' | 'sent' | 'answered' | 'expired' | 'cancelled';
  answer_label: string | null;
  answered_by: string | null;
  answered_at: string | null;
  sent_at: string | null;
  send_at: string;
  groups: { name: string } | null;
};

export type ClosingMetrics = { days: number; sent: number; answered: number; waiting: number; expired: number; by_answer: Record<string, number> };
type Member = { id: string; name: string; jid: string };

const STATUS: Record<SurveyItem['status'], { label: string; tone: 'neutral' | 'good' | 'warning' | 'info' }> = {
  scheduled: { label: 'Agendada', tone: 'info' },
  sent: { label: 'Aguardando resposta', tone: 'warning' },
  answered: { label: 'Respondida', tone: 'good' },
  expired: { label: 'Sem resposta', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function FlowForm({
  flow,
  groups,
  sectors,
  members,
  takenGroupIds,
  onClose,
}: {
  flow: ClosingFlowItem | null;
  groups: GroupOption[];
  sectors: SectorOption[];
  members: Member[];
  /** grupos que já estão em outra regra */
  takenGroupIds: Set<string>;
  onClose: () => void;
}) {
  const [name, setName] = useState(flow?.name ?? 'Pesquisa de encerramento');
  const [enabled, setEnabled] = useState(flow?.enabled ?? true);
  const [question, setQuestion] = useState(flow?.question ?? DEFAULT_QUESTION);
  const [options, setOptions] = useState<ClosingOptionValue[]>(flow?.options ?? DEFAULT_OPTIONS);
  const [picked, setPicked] = useState<Set<string>>(new Set(flow?.group_ids ?? []));
  const [delay, setDelay] = useState(String(flow?.delay_min ?? 5));
  const [expire, setExpire] = useState(String(flow?.expire_hours ?? 24));
  const [notifyJid, setNotifyJid] = useState(flow?.notify_group_jid ?? '');
  const [mentions, setMentions] = useState<Set<string>>(new Set(flow?.mention_jids ?? []));
  const [pending, startTransition] = useTransition();

  const setOption = (i: number, patch: Partial<ClosingOptionValue>) => setOptions((prev) => prev.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const toggleMention = (jid: string) =>
    setMentions((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  // o grupo interno não pode ser um dos grupos dos clientes
  const notifyOptions = groups.filter((g) => !picked.has(g.id));

  const save = () =>
    startTransition(async () => {
      const res = await saveClosingFlow(flow?.id ?? null, {
        name,
        enabled,
        question,
        options,
        groupIds: [...picked],
        delayMin: delay,
        expireHours: expire,
        notifyGroupJid: notifyJid,
        notifyGroupName: groups.find((g) => g.jid === notifyJid)?.name ?? flow?.notify_group_name ?? '',
        mentionJids: [...mentions],
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success('Regra salva');
      onClose();
    });

  const remove = () => {
    if (!flow || !confirm(`Excluir a regra "${flow.name}"? O que já foi enviado continua no histórico.`)) return;
    startTransition(async () => {
      const res = await deleteClosingFlow(flow.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Regra excluída');
      onClose();
    });
  };

  return (
    <Card>
      <CardHeader
        title={flow ? `Regra: ${flow.name}` : 'Nova regra de encerramento'}
        description="Depois que a equipe encerra o atendimento no grupo, o cliente recebe uma enquete. Cada opção define o que o sistema faz."
        action={
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar o formulário">
            <X className="h-4 w-4" />
          </Button>
        }
      />
      <div className="space-y-5 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome da regra">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={pending} />
          </Field>
          <Field label="Pergunta enviada ao cliente" hint="Aparece como título da enquete.">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} disabled={pending} />
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-2">Opções de resposta (o “botão” do cliente)</p>
          <ul className="space-y-3">
            {options.map((o, i) => (
              <li key={i} className="space-y-2 rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted">{i + 1}</span>
                  <Input value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} maxLength={100} placeholder="Texto da opção" disabled={pending} aria-label={`Texto da opção ${i + 1}`} />
                  <Button variant="ghost" size="sm" onClick={() => setOptions((p) => p.filter((_, k) => k !== i))} disabled={pending || options.length <= MIN_OPTIONS} aria-label={`Remover a opção ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea value={o.reply} onChange={(e) => setOption(i, { reply: e.target.value })} rows={2} maxLength={1000} placeholder="Resposta enviada ao grupo do cliente (deixe vazio para não responder)" disabled={pending} />
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Toggle checked={o.notify} onChange={(v) => setOption(i, { notify: v })} disabled={pending} label={<span className="text-sm">Avisar o grupo interno</span>} />
                  <Toggle checked={o.reopen} onChange={(v) => setOption(i, { reopen: v })} disabled={pending} label={<span className="text-sm">Reabrir o atendimento (alerta + pendente)</span>} />
                </div>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" onClick={() => setOptions((p) => [...p, emptyOption()])} disabled={pending || options.length >= MAX_OPTIONS}>
            <Plus className="h-4 w-4" /> Adicionar opção
          </Button>
          <p className="text-xs text-muted">O cliente também pode responder digitando o número (1, 2…) ou o texto da opção.</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-ink-2">Grupos de clientes que recebem a pergunta</p>
          <GroupPicker
            groups={groups.filter((g) => g.jid !== notifyJid)}
            sectors={sectors}
            selected={picked}
            onChange={setPicked}
            takenGroupIds={takenGroupIds}
            excludeJids={new Set()}
            disabled={pending}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Enviar depois de (min)" hint="Tempo entre o fechamento e a pergunta. Se o cliente escrever antes, ela é cancelada.">
            <Input type="number" min={0} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} disabled={pending} />
          </Field>
          <Field label="Aguardar a resposta por (h)">
            <Input type="number" min={1} inputMode="numeric" value={expire} onChange={(e) => setExpire(e.target.value)} disabled={pending} />
          </Field>
        </div>

        <Field label="Grupo interno (recebe os avisos das opções)" hint="O número conectado precisa participar dele.">
          <Select value={notifyJid} onChange={(e) => setNotifyJid(e.target.value)} disabled={pending}>
            <option value="">Sem grupo interno</option>
            {notifyOptions.map((g) => (
              <option key={g.id} value={g.jid}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>

        {members.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-2">Quem é marcado no aviso</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <label key={m.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs has-[:checked]:border-brand-line has-[:checked]:bg-brand-soft">
                  <input type="checkbox" className="sr-only" checked={mentions.has(m.jid)} onChange={() => toggleMention(m.jid)} disabled={pending} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <Toggle checked={enabled} onChange={setEnabled} disabled={pending} label={<span className="text-sm">Regra ligada</span>} />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={pending}>
            <Save className="h-4 w-4" /> Salvar a regra
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          {flow && (
            <Button variant="danger" className="ml-auto" onClick={remove} disabled={pending}>
              <Trash2 className="h-4 w-4" /> Excluir regra
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ClosingPanel({
  isAdmin,
  flows,
  surveys,
  metrics,
  groups,
  sectors,
  members,
}: {
  isAdmin: boolean;
  flows: ClosingFlowItem[];
  surveys: SurveyItem[];
  metrics: ClosingMetrics | null;
  groups: GroupOption[];
  sectors: SectorOption[];
  members: Member[];
}) {
  // 'new' = criar; uma regra = editar
  const [editing, setEditing] = useState<'new' | ClosingFlowItem | null>(null);
  const [busy, startTransition] = useTransition();
  const takenFor = (self: string | null) => new Set(flows.filter((f) => f.id !== self).flatMap((f) => f.group_ids));

  const toggle = (f: ClosingFlowItem, enabled: boolean) =>
    startTransition(async () => {
      const res = await setClosingFlowEnabled(f.id, enabled);
      if (!res.ok) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <>
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Mensagem de encerramento
            </>
          }
          description="Quando a equipe encerra o atendimento num grupo, o sistema envia uma enquete ao cliente (“Seu atendimento foi resolvido?”) e age conforme a resposta: responde no grupo, avisa o grupo interno e/ou reabre o atendimento. O WhatsApp não permite botões de verdade em grupos para números comuns; a enquete faz o papel de botão."
          action={
            isAdmin && !editing ? (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" /> Nova regra
              </Button>
            ) : undefined
          }
        />
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3 sm:grid-cols-4 sm:px-5 sm:pb-5">
          <Metric label={`Enviadas (${metrics?.days ?? 30} dias)`} value={String(metrics?.sent ?? 0)} />
          <Metric label="Respondidas" value={String(metrics?.answered ?? 0)} />
          <Metric label="Aguardando" value={String(metrics?.waiting ?? 0)} />
          <Metric label="Sem resposta" value={String(metrics?.expired ?? 0)} />
        </div>
        {metrics && Object.keys(metrics.by_answer).length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
            {Object.entries(metrics.by_answer).map(([label, n]) => (
              <Badge key={label} tone="brand">
                {label}: {n}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <FlowForm
          key={editing === 'new' ? 'new' : editing.id}
          flow={editing === 'new' ? null : editing}
          groups={groups}
          sectors={sectors}
          members={members}
          takenGroupIds={takenFor(editing === 'new' ? null : editing.id)}
          onClose={() => setEditing(null)}
        />
      )}

      <Card>
        <CardHeader title="Regras" description="A primeira regra ligada que cobre o grupo é a usada." />
        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
          {flows.length === 0 ? (
            <EmptyState icon={<ClipboardCheck />} title="Nenhuma regra ainda" description={isAdmin ? 'Crie a primeira em “Nova regra”.' : 'Um administrador cria as regras.'} />
          ) : (
            <ul className="divide-y divide-line">
              {flows.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{f.name}</p>
                    <p className="truncate text-xs text-ink-2">
                      “{f.question}” · {f.options.map((o) => o.label).join(' / ')} · {f.group_ids.length} grupo(s) · após {f.delay_min} min
                    </p>
                  </div>
                  <Toggle checked={f.enabled} onChange={(v) => toggle(f, v)} disabled={!isAdmin || busy} label={<span className="text-xs">{f.enabled ? 'Ligada' : 'Desligada'}</span>} />
                  {isAdmin && (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(f)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Últimas perguntas" description="Enviadas aos clientes e o que eles responderam." />
        <div className="px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
          {surveys.length === 0 ? (
            <p className="text-sm text-muted">Nada enviado ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {surveys.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{s.groups?.name ?? 'Grupo'}</p>
                    <p className="truncate text-xs text-ink-2">
                      {s.status === 'answered' ? `${s.answered_by ? `${s.answered_by}: ` : ''}${s.answer_label}` : STATUS[s.status].label}
                    </p>
                  </div>
                  <span className="text-xs text-ink-2">{timeAgo(s.answered_at ?? s.sent_at ?? s.send_at)}</span>
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
