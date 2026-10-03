'use client';

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { formatDateTime, formatNumber, REMOVED_REASON_LABEL, timeAgo } from '@/lib/format';
import type { Group } from '@/lib/types';
import { deleteRemovedGroups } from '../actions';

export type RemovedGroup = Group & { message_count: number };

export const CONFIRM_DELETE =
  'Excluir definitivamente {n}?\n\nTodas as mensagens, métricas e alertas serão apagados. Esta ação não pode ser desfeita.';

/** Grupos que saíram do WhatsApp: acompanhamento e exclusão definitiva. */
export function RemovedGroups({ groups, isAdmin }: { groups: RemovedGroup[]; isAdmin: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const allSelected = groups.length > 0 && groups.every((g) => selected.has(g.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = (ids: string[], label: string) => {
    if (!window.confirm(CONFIRM_DELETE.replace('{n}', label))) return;
    start(async () => {
      const res = await deleteRemovedGroups(ids);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(ids.length === 1 ? 'Grupo excluído definitivamente' : `${ids.length} grupos excluídos definitivamente`);
      setSelected(new Set());
    });
  };

  return (
    <>
      <div className="border-b border-line px-5 py-3 text-xs text-ink-2">
        Grupos dos quais o número conectado saiu, foi removido ou que foram apagados no celular. O histórico continua
        disponível para consulta. Se o número voltar ao grupo, ele é reativado automaticamente.
      </div>
      {isAdmin && selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-critical/5 px-5 py-3">
          <span className="text-sm font-medium">{selected.size} grupo(s) selecionado(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={pending}>
              Limpar seleção
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => remove([...selected], `${selected.size} grupo(s)`)}>
              <Trash2 className="h-3.5 w-3.5" /> Excluir definitivamente
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              {isAdmin && (
                <th className="w-10 py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.id)))}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                </th>
              )}
              <th className="px-5 py-3 font-medium">Grupo</th>
              <th className="px-3 py-3 font-medium">Motivo</th>
              <th className="px-3 py-3 font-medium">Excluído em</th>
              <th className="px-3 py-3 text-right font-medium">Mensagens</th>
              <th className="px-3 py-3 font-medium">Última mensagem</th>
              {isAdmin && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-t border-line">
                {isAdmin && (
                  <td className="py-3 pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${g.name}`}
                      checked={selected.has(g.id)}
                      onChange={() => toggle(g.id)}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                  </td>
                )}
                <td className="px-5 py-3">
                  <Link href={`/groups/${g.id}`} className="flex items-center gap-3 hover:text-brand">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">
                      {g.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="max-w-[220px] truncate font-medium">{g.name}</span>
                  </Link>
                </td>
                <td className="max-w-[240px] px-3 py-3 text-ink-2">
                  {REMOVED_REASON_LABEL[g.removed_reason ?? ''] ?? 'Saiu do WhatsApp'}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {formatDateTime(g.removed_at)}
                  <p className="text-xs text-muted">{timeAgo(g.removed_at)}</p>
                </td>
                <td className="tabular px-3 py-3 text-right">{formatNumber(g.message_count)}</td>
                <td className="px-3 py-3 text-xs text-muted whitespace-nowrap">{timeAgo(g.last_message_at)}</td>
                {isAdmin && (
                  <td className="px-5 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-critical-ink"
                      disabled={pending}
                      onClick={() => remove([g.id], `o grupo "${g.name}"`)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DeleteRemovedGroupButton({ groupId, name }: { groupId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(CONFIRM_DELETE.replace('{n}', `o grupo "${name}"`))) return;
        start(async () => {
          const res = await deleteRemovedGroups([groupId]);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success('Grupo excluído definitivamente');
          router.replace('/groups?filter=removed');
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" /> Excluir definitivamente
    </Button>
  );
}
