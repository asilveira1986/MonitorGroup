'use client';

import { Lock, MessageSquareText, Pencil, Plus, Save, Search, Trash2, X, Zap } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, EmptyState, Input, Select, Textarea } from '@/components/ui';
import { greeting, normalizeShortcut, QUICK_REPLY_VARIABLES, renderQuickReply, type QuickReply } from '@/lib/quick-replies';
import { deleteQuickReply, saveClosingShortcut, saveQuickReply } from '../actions';

const EMPTY = { id: null as string | null, shortcut: '', title: '', body: '' };
const SAMPLE = { cliente: 'Carla', grupo: 'Vendas SP', atendente: 'Ana Souza' };
const CLOSING_TEMPLATE =
  '{saudacao}, {cliente}! Estamos encerrando este atendimento. Qualquer dúvida, é só chamar por aqui.';

/** Cadastro das mensagens rápidas (usadas na conversa com \atalho). */
export function QuickReplies({
  initial,
  canEdit,
  missingTable,
  closingShortcut,
}: {
  initial: QuickReply[];
  canEdit: boolean;
  missingTable: boolean;
  closingShortcut: string;
}) {
  const [list, setList] = useState(initial);
  const [closing, setClosing] = useState(closingShortcut);
  const [form, setForm] = useState(EMPTY);
  const [query, setQuery] = useState('');
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editing = form.id !== null;
  const shortcut = normalizeShortcut(form.shortcut);
  const duplicate = list.some((r) => r.shortcut === shortcut && r.id !== form.id);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? list.filter((r) => r.shortcut.includes(normalizeShortcut(q)) || `${r.title ?? ''} ${r.body}`.toLowerCase().includes(q))
      : list;
  }, [list, query]);

  const insertVar = (key: string) => {
    const el = bodyRef.current;
    const token = `{${key}}`;
    const startPos = el?.selectionStart ?? form.body.length;
    const endPos = el?.selectionEnd ?? form.body.length;
    setForm((f) => ({ ...f, body: `${f.body.slice(0, startPos)}${token}${f.body.slice(endPos)}` }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(startPos + token.length, startPos + token.length);
    });
  };

  const save = () =>
    start(async () => {
      const res = await saveQuickReply({ id: form.id, shortcut, title: form.title, body: form.body });
      if (!res.ok) return void toast.error(res.error);
      const item = res.item!;
      setList((prev) => [...prev.filter((r) => r.id !== item.id), item].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
      setForm(EMPTY);
      toast.success(editing ? 'Mensagem rápida alterada' : 'Mensagem rápida criada', { description: `Use \\${item.shortcut} na conversa.` });
    });

  const remove = (r: QuickReply) =>
    start(async () => {
      if (!confirm(`Excluir a mensagem rápida \\${r.shortcut}?`)) return;
      const res = await deleteQuickReply(r.id);
      if (!res.ok) return void toast.error(res.error);
      setList((prev) => prev.filter((x) => x.id !== r.id));
      if (form.id === r.id) setForm(EMPTY);
    });

  if (missingTable) {
    return (
      <Card>
        <EmptyState
          icon={<Zap />}
          title="Mensagens rápidas ainda não instaladas"
          description="Execute o supabase/atualizar_banco.sql no SQL Editor do Supabase para liberar esta função."
        />
      </Card>
    );
  }

  const closingReply = list.find((r) => r.shortcut === closing);
  const changeClosing = (value: string) =>
    start(async () => {
      const prev = closing;
      setClosing(value);
      const res = await saveClosingShortcut(value);
      if (!res.ok) {
        setClosing(prev);
        toast.error(res.error);
      } else toast.success(`\\${value} agora encerra a conversa`);
    });

  return (
    <div className="space-y-4">
      <Card className="border-good/40">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-good-ink" />
            <div>
              <p className="text-sm font-medium">Mensagem de fechamento</p>
              <p className="mt-0.5 text-xs text-ink-2">
                Quando a equipe envia esta mensagem (pelo sistema ou pelo celular, com o mesmo texto), a conversa do grupo é
                encerrada: agradecimentos e mensagens configuradas para ignorar não a reabrem, e a próxima mensagem do cliente
                que pedir resposta inicia uma nova conversa.
              </p>
              {!closingReply && (
                <p className="mt-1 text-xs font-medium text-warning-ink">
                  Ainda não existe a mensagem rápida \{closing}: crie-a para usar o fechamento.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && list.length > 0 && (
              <Select
                value={closing}
                onChange={(e) => changeClosing(e.target.value)}
                disabled={pending}
                aria-label="Atalho que encerra a conversa"
                className="h-9 w-44 font-mono text-sm"
              >
                {!closingReply && <option value={closing}>\{closing} (não criada)</option>}
                {list.map((r) => (
                  <option key={r.id} value={r.shortcut}>
                    \{r.shortcut}
                  </option>
                ))}
              </Select>
            )}
            {canEdit && !closingReply && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setForm({ id: null, shortcut: closing, title: 'Fechamento do atendimento', body: CLOSING_TEMPLATE })}
              >
                <Plus className="h-4 w-4" /> Criar \{closing}
              </Button>
            )}
          </div>
        </div>
      </Card>
    <div className="grid gap-4 lg:grid-cols-5">
      {canEdit && (
        <Card className="lg:col-span-2">
          <CardHeader
            title={editing ? `Editar \\${form.shortcut || '…'}` : 'Nova mensagem rápida'}
            description="Na caixa de resposta da conversa, digite \ e o atalho para inserir o texto."
          />
          <div className="space-y-3 p-4 sm:p-5">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Atalho</span>
              <span className="flex items-center rounded-xl border border-line bg-surface focus-within:border-brand-line">
                <span className="pl-3 font-mono text-muted">\</span>
                <input
                  value={form.shortcut}
                  onChange={(e) => setForm((f) => ({ ...f, shortcut: normalizeShortcut(e.target.value) }))}
                  placeholder="boleto"
                  aria-label="Atalho"
                  className="h-10 w-full rounded-xl bg-transparent px-1 font-mono text-sm outline-none"
                  maxLength={30}
                />
              </span>
              <span className={duplicate ? 'mt-1 block text-xs text-critical-ink' : 'mt-1 block text-xs text-muted'}>
                {duplicate ? 'Já existe uma mensagem com esse atalho.' : 'Letras minúsculas, números, - e _ (sem espaço).'}
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Nome (opcional)</span>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="2ª via do boleto"
                maxLength={80}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Mensagem</span>
              <Textarea
                ref={bodyRef}
                rows={6}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value.slice(0, 4000) }))}
                placeholder="{saudacao}, {cliente}! Segue a 2ª via do boleto. Qualquer dúvida, estamos à disposição."
                aria-label="Texto da mensagem rápida"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted">Inserir:</span>
              {QUICK_REPLY_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  title={v.label}
                  className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:border-brand-line hover:text-ink"
                >
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
            {form.body.trim() && (
              <p className="whitespace-pre-wrap rounded-xl bg-surface-2/60 px-3 py-2 text-xs text-ink-2">
                <span className="text-muted">Exemplo: </span>
                {renderQuickReply(form.body, { ...SAMPLE, saudacao: capitalize(greeting()) })}
              </p>
            )}
            <div className="flex gap-2">
              <Button disabled={pending || !shortcut || !form.body.trim() || duplicate} onClick={save}>
                {editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editing ? 'Salvar alteração' : 'Criar mensagem rápida'}
              </Button>
              {(editing || form.body || form.shortcut) && (
                <Button variant="ghost" onClick={() => setForm(EMPTY)} disabled={pending}>
                  <X className="h-4 w-4" /> Cancelar
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className={canEdit ? 'lg:col-span-3' : 'lg:col-span-5'}>
        <CardHeader
          title="Mensagens rápidas"
          description={`${list.length} mensagem(ns) · na conversa, digite \\ para ver a lista`}
          action={
            list.length > 5 ? (
              <label className="relative block w-48">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar"
                  aria-label="Buscar mensagem rápida"
                  className="h-9 w-full rounded-xl border border-line bg-surface pl-8 pr-2 text-sm outline-none focus:border-brand-line"
                />
              </label>
            ) : undefined
          }
        />
        <div className="p-2">
          {shown.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText />}
              title={list.length ? 'Nenhuma mensagem encontrada' : 'Nenhuma mensagem rápida'}
              description={list.length ? undefined : 'Crie textos prontos para responder mais rápido, ex.: \\boleto, \\horario, \\documentos.'}
            />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-3 py-3">
                  <span className="mt-0.5 shrink-0 rounded-lg bg-brand-soft px-2 py-1 font-mono text-xs font-semibold text-brand-text">
                    \{r.shortcut}
                  </span>
                  <div className="min-w-0 flex-1">
                    {r.shortcut === closing && (
                      <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-good/15 px-1.5 py-px text-[10px] font-medium text-good-ink">
                        <Lock className="h-3 w-3" /> encerra a conversa
                      </span>
                    )}
                    {r.title && <p className="text-sm font-medium">{r.title}</p>}
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs text-ink-2">{r.body}</p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setForm({ id: r.id, shortcut: r.shortcut, title: r.title ?? '', body: r.body })}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                        aria-label={`Editar \\${r.shortcut}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        disabled={pending}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-critical-ink"
                        aria-label={`Excluir \\${r.shortcut}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
