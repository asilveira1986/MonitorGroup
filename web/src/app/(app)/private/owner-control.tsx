'use client';

import { Loader2, UserCheck, UserRound } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { assignPrivateChat } from './actions';

export type ChatAgent = { id: string; name: string };

/**
 * Responsável pela conversa (0114): "Assumir" na conversa sem responsável; o responsável (ou um
 * administrador) transfere para outra pessoa ou devolve para "Sem responsável".
 */
export function OwnerControl({
  chatId,
  owner,
  me,
  seesAll,
  agents,
  onChange,
}: {
  chatId: string;
  owner: string | null | undefined;
  me: string;
  seesAll: boolean;
  agents: ChatAgent[];
  onChange: (owner: string | null) => void;
}) {
  const [pending, start] = useTransition();
  const set = (user: string | null, done: string) =>
    start(async () => {
      const res = await assignPrivateChat(chatId, user);
      if (!res.ok) return void toast.error(res.error);
      onChange(user);
      toast.success(done);
    });
  const nameOf = (id: string) => (id === me ? 'Você' : (agents.find((a) => a.id === id)?.name ?? 'outro usuário'));
  const canChange = !owner || owner === me || seesAll;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {owner ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 font-medium text-good-ink">
          <UserCheck className="h-3.5 w-3.5" /> {nameOf(owner)}
        </span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning-ink">
            <UserRound className="h-3.5 w-3.5" /> Sem responsável
          </span>
          <Button type="button" size="sm" disabled={pending} onClick={() => set(me, 'Conversa assumida')}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Assumir
          </Button>
        </>
      )}
      {canChange && (
        <select
          value=""
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'none') set(null, 'Conversa devolvida para "Sem responsável"');
            else if (v) set(v, `Conversa transferida para ${nameOf(v)}`);
          }}
          aria-label="Transferir a conversa"
          className="h-8 rounded-lg border border-line bg-surface px-2 text-base text-ink-2 outline-none focus:border-brand-line sm:h-7 sm:text-xs"
        >
          <option value="">{owner ? 'Transferir…' : 'Passar para…'}</option>
          {agents
            .filter((a) => a.id !== owner)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === me ? `${a.name} (você)` : a.name}
              </option>
            ))}
          {owner && <option value="none">Devolver para “Sem responsável”</option>}
        </select>
      )}
    </div>
  );
}
