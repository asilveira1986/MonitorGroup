'use client';

import { ArrowRightLeft, CheckCircle2, Loader2, RotateCcw, Search, UserCheck, UserRound, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/format';
import { assignPrivateChat, finishPrivateChat, reopenPrivateChat } from './actions';

export type ChatAgent = { id: string; name: string; email?: string | null };

/** Transferir para outro usuário (com observação opcional) ou devolver para "Aguardando". */
function TransferDialog({
  owner,
  me,
  agents,
  onClose,
  onConfirm,
}: {
  owner: string | null | undefined;
  me: string;
  agents: ChatAgent[];
  onClose: () => void;
  onConfirm: (user: string | null, note: string) => Promise<boolean>;
}) {
  const [q, setQ] = useState('');
  const [to, setTo] = useState<string | 'queue' | null>(null);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const term = q.trim().toLowerCase();
  const list = agents.filter((a) => a.id !== owner && (!term || a.name.toLowerCase().includes(term)));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Transferir atendimento">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">Transferir atendimento</h2>
            <p className="text-xs text-ink-2">Escolha quem vai continuar o atendimento. A pessoa é avisada.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar usuário"
              aria-label="Buscar usuário"
              autoFocus
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base outline-none focus:border-brand-line sm:text-sm"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2" role="radiogroup" aria-label="Para quem">
          {list.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="radio"
                aria-checked={to === a.id}
                onClick={() => setTo(a.id)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2', to === a.id && 'bg-brand-soft/70')}
              >
                <UserRound className="h-4 w-4 text-muted" />
                <span className="flex-1">
                  {a.id === me ? `${a.name} (você)` : a.name}
                  {/* nome repetido: o e-mail diferencia */}
                  {a.email && agents.filter((x) => x.name === a.name).length > 1 && <span className="block text-xs text-muted">{a.email}</span>}
                </span>
                {to === a.id && <CheckCircle2 className="h-4 w-4 text-brand-text" />}
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-2 text-sm text-muted">Nenhum usuário encontrado.</li>}
          {owner && (
            <li className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                role="radio"
                aria-checked={to === 'queue'}
                onClick={() => setTo('queue')}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-2', to === 'queue' && 'bg-brand-soft/70')}
              >
                <RotateCcw className="h-4 w-4 text-muted" />
                <span className="flex-1">Devolver para “Aguardando” (sem responsável)</span>
                {to === 'queue' && <CheckCircle2 className="h-4 w-4 text-brand-text" />}
              </button>
            </li>
          )}
        </ul>
        <div className="space-y-3 border-t border-line p-4">
          {to && to !== 'queue' && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Observação para quem recebe (opcional)"
              aria-label="Observação"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!to || pending}
              onClick={() =>
                start(async () => {
                  if (await onConfirm(to === 'queue' ? null : to, note)) onClose();
                })
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} {to === 'queue' ? 'Devolver' : 'Transferir'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Atendimento da conversa (0114/0119): "Assumir" na que está aguardando; o responsável (ou um
 * administrador) transfere, finaliza ou reabre.
 */
export function OwnerControl({
  chatId,
  owner,
  closed,
  me,
  seesAll,
  agents,
  onChange,
  onClosed,
}: {
  chatId: string;
  owner: string | null | undefined;
  closed: boolean;
  me: string;
  seesAll: boolean;
  agents: ChatAgent[];
  onChange: (owner: string | null) => void;
  onClosed: (closed: boolean, owner: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const [transferring, setTransferring] = useState(false);
  const nameOf = (id: string) => (id === me ? 'Você' : (agents.find((a) => a.id === id)?.name ?? 'outro usuário'));
  const canChange = !owner || owner === me || seesAll;
  const assign = async (user: string | null, note = '') => {
    const res = await assignPrivateChat(chatId, user, note);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (closed) onClosed(false, user);
    else onChange(user);
    toast.success(user === me ? 'Atendimento assumido' : user ? `Transferido para ${nameOf(user)}` : 'Devolvido para “Aguardando”');
    return true;
  };
  const btn = 'inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50 sm:h-7';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {closed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-2">
          <CheckCircle2 className="h-3.5 w-3.5" /> Finalizado
        </span>
      ) : owner ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 font-medium text-good-ink">
          <UserCheck className="h-3.5 w-3.5" /> {nameOf(owner)}
        </span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning-ink">
            <UserRound className="h-3.5 w-3.5" /> Aguardando
          </span>
          <Button type="button" size="sm" disabled={pending} onClick={() => start(async () => void (await assign(me)))}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Assumir
          </Button>
        </>
      )}
      {canChange && !closed && (
        <>
          <button type="button" className={btn} disabled={pending} onClick={() => setTransferring(true)} title="Transferir para outro usuário">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Transferir
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            title="Finalizar o atendimento"
            onClick={() => {
              if (!confirm('Finalizar este atendimento?\n\nA conversa vai para “Finalizados”. Se o cliente escrever de novo, ela volta para “Aguardando”.')) return;
              start(async () => {
                const res = await finishPrivateChat(chatId);
                if (!res.ok) return void toast.error(res.error);
                onClosed(true, owner ?? me);
                toast.success('Atendimento finalizado');
              });
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
          </button>
        </>
      )}
      {closed && (
        <button
          type="button"
          className={btn}
          disabled={pending}
          title="Reabrir o atendimento com você"
          onClick={() =>
            start(async () => {
              const res = await reopenPrivateChat(chatId);
              if (!res.ok) return void toast.error(res.error);
              onClosed(false, me);
              toast.success('Atendimento reaberto com você');
            })
          }
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reabrir
        </button>
      )}
      {transferring && (
        <TransferDialog owner={owner} me={me} agents={agents} onClose={() => setTransferring(false)} onConfirm={(user, note) => assign(user, note)} />
      )}
    </div>
  );
}
