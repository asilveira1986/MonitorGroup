'use client';

import { Gift, Plus, Tag, Trash2, Zap } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { CustomerTag } from '@/components/customer-tags';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { DEFAULT_WINDOW, describeTrigger, MEDIA_TYPE_LABEL, TRIGGER_KIND_LABEL, validateTrigger, WEEKDAY_LABEL, type BroadcastMedia, type BroadcastTarget, type BroadcastTrigger, type BroadcastWindow, type TriggerKind } from '@/lib/broadcast';
import { formatDateTime } from '@/lib/format';
import { deleteBroadcastTrigger, saveBroadcastTrigger, setBroadcastTriggerEnabled } from '../actions';
import { MediaField, VariantsField, WindowField } from '../fields';
import type { InstanceOption } from '../new/new-broadcast';

/** Lista dos gatilhos e o formulário de novo gatilho. */
export function Triggers({
  items,
  tags,
  instances,
  birthdays,
  timezone,
}: {
  items: BroadcastTrigger[];
  tags: CustomerTag[];
  instances: InstanceOption[];
  /** contatos com aniversário cadastrado (null = banco sem o script) */
  birthdays: number | null;
  timezone: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(items.length === 0);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TriggerKind>('tag_applied');
  const [tagId, setTagId] = useState('');
  const [sendTime, setSendTime] = useState('09:00');
  const [target, setTarget] = useState<BroadcastTarget>('people');
  const [instanceId, setInstanceId] = useState(instances.find((i) => i.status === 'connected')?.id ?? instances[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [footer, setFooter] = useState(true);
  const [includeExisting, setIncludeExisting] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [media, setMedia] = useState<BroadcastMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [windowOn, setWindowOn] = useState(false);
  const [win, setWin] = useState<BroadcastWindow>(DEFAULT_WINDOW);

  const tagName = (id: string | null) => tags.find((t) => t.id === id)?.name ?? null;
  const people = kind === 'birthday' || target === 'people';

  const save = () =>
    start(async () => {
      const input = { name, kind, tagId: kind === 'tag_applied' ? tagId : null, sendTime, target: kind === 'birthday' ? 'people' : target, instanceId: people ? instanceId : null, message, optoutFooter: footer && people, includeExisting, variants: variants.map((v) => v.trim()).filter(Boolean), media, window: windowOn ? win : null };
      const checked = validateTrigger(input);
      if (!checked.ok) {
        toast.error(checked.error);
        return;
      }
      const r = await saveBroadcastTrigger(input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success('Gatilho criado.');
      setName('');
      setMessage('');
      setVariants([]);
      setMedia(null);
      setWindowOn(false);
      setOpen(false);
    });

  const toggle = (t: BroadcastTrigger, enabled: boolean) =>
    start(async () => {
      const r = await setBroadcastTriggerEnabled(t.id, enabled);
      if (!r.ok) toast.error(r.error);
    });

  const remove = (t: BroadcastTrigger) => {
    if (!confirm(`Excluir o gatilho “${t.name}”? Os envios que ele já criou continuam na lista de disparos.`)) return;
    start(async () => {
      const r = await deleteBroadcastTrigger(t.id);
      if (!r.ok) toast.error(r.error);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Gatilhos"
          action={
            !open && (
              <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> Novo gatilho
              </Button>
            )
          }
        />
        {items.length === 0 ? (
          <EmptyState icon={<Zap />} title="Nenhum gatilho ainda" description="Crie o primeiro abaixo: por exemplo, dar boas-vindas a quem recebe a etiqueta “Novo cliente”." />
        ) : (
          <ul className="divide-y divide-line/60 p-2">
            {items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {t.kind === 'birthday' ? <Gift className="h-4 w-4 text-muted" /> : <Tag className="h-4 w-4 text-muted" />}
                    {t.name}
                    <Badge tone="neutral">{TRIGGER_KIND_LABEL[t.kind]}</Badge>
                    {!t.enabled && <Badge tone="warning">Desligado</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">{describeTrigger(t, tagName(t.tag_id))}</p>
                  {t.message && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{t.message}</p>}
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    {t.media_path && <span>Arquivo: {MEDIA_TYPE_LABEL[t.media_type as keyof typeof MEDIA_TYPE_LABEL] ?? 'Arquivo'}{t.media_name ? ` · ${t.media_name}` : ''}</span>}
                    {(t.variants?.length ?? 0) > 0 && <span>{t.variants!.length} variação(ões)</span>}
                    {t.window_enabled && <span>Só {(t.window_days ?? []).map((d) => WEEKDAY_LABEL[d]).join(', ')}, das {t.window_start} às {t.window_end}</span>}
                  </p>
                  {t.last_run_at && (
                    <p className="mt-0.5 text-xs text-muted">
                      Último envio: {formatDateTime(t.last_run_at)}
                      {t.last_run_note ? ` · ${t.last_run_note}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Toggle checked={t.enabled} onChange={(v) => toggle(t, v)} disabled={pending} label={t.enabled ? 'Ligado' : 'Desligado'} />
                  <button type="button" onClick={() => remove(t)} disabled={pending} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label={`Excluir o gatilho ${t.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <Card>
          <CardHeader title="Novo gatilho" />
          <div className="space-y-4 p-4 sm:p-5">
            <Field label="Nome" hint="Só para você se achar depois.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Boas-vindas a novos clientes" />
            </Field>

            <div className="flex flex-wrap gap-2">
              {(['tag_applied', 'birthday'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${kind === k ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                >
                  {k === 'birthday' ? <Gift className="h-4 w-4" /> : <Tag className="h-4 w-4" />} {TRIGGER_KIND_LABEL[k]}
                </button>
              ))}
            </div>

            {kind === 'tag_applied' ? (
              <div className="space-y-3">
                <Field label="Quando receber a etiqueta" hint="Vale para quem recebe a etiqueta daqui para frente. Cada pessoa (ou grupo) recebe uma vez só.">
                  <Select value={tagId} onChange={(e) => setTagId(e.target.value)} className="max-w-sm">
                    <option value="">Escolha a etiqueta</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex gap-2">
                  {(['people', 'groups'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setTarget(t)} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${target === t ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}>
                      {t === 'people' ? 'Pessoas (mensagem individual)' : 'Grupos'}
                    </button>
                  ))}
                </div>
                <Toggle checked={includeExisting} onChange={setIncludeExisting} label="Enviar também para quem já tem a etiqueta agora" />
              </div>
            ) : (
              <div className="space-y-2">
                <Field label="Enviar às" hint="No dia do aniversário, a partir desse horário (fuso da empresa). Se o sistema estiver parado nessa hora, envia assim que voltar, no mesmo dia.">
                  <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} className="w-32" />
                </Field>
                <p className="text-xs text-ink-2">
                  {birthdays === null
                    ? 'Rode o script do banco (0153) para cadastrar aniversários.'
                    : `${birthdays} contato(s) com aniversário cadastrado. O aniversário se preenche em Contatos, ao editar o contato.`}
                </p>
              </div>
            )}

            {people && (
              <Field label="Número do WhatsApp que envia">
                <Select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className="max-w-sm">
                  {instances.length === 0 && <option value="">Nenhum número conectado</option>}
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.phone ? ` (${i.phone})` : ''}
                      {i.status !== 'connected' ? ' — desconectado' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Mensagem (legenda, se houver arquivo)" hint={kind === 'tag_applied' && target === 'groups' ? 'Use {grupo} para o nome do grupo.' : 'Use {primeiro_nome} ou {nome}.'}>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={4000} placeholder={kind === 'birthday' ? 'Parabéns, {primeiro_nome}! 🎉 …' : 'Olá, {primeiro_nome}! Bem-vindo(a) …'} />
            </Field>

            <VariantsField value={variants} onChange={setVariants} />
            <MediaField value={media} onChange={setMedia} onBusyChange={setUploading} />
            <div className="border-t border-line/60 pt-3">
              <WindowField enabled={windowOn} onEnabledChange={setWindowOn} value={win} onChange={setWin} timezone={timezone} />
            </div>

            {people && <Toggle checked={footer} onChange={setFooter} label="Incluir “Para não receber mais mensagens, responda SAIR.” no fim" />}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={pending || uploading || !name.trim() || (!message.trim() && !media)}>
                <Zap className="h-4 w-4" /> {pending ? 'Criando…' : 'Criar gatilho'}
              </Button>
              {items.length > 0 && (
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">O envio segue o ritmo configurado em Disparos (intervalo entre mensagens, lotes e limite de 24 h) e respeita quem pediu para não receber.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
