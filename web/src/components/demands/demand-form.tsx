'use client';

import { X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createDemand } from '@/app/(app)/demands/actions';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

type Option = { id: string; name: string };

/** Formulário de nova demanda (tela de Demandas ou a partir de uma mensagem da conversa). */
export function DemandForm({
  groups,
  members,
  types,
  initial,
  onClose,
}: {
  groups: Option[];
  members: Option[];
  types: string[];
  initial?: { groupId?: string; messageId?: string; description?: string; groupName?: string };
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Nova demanda">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        className="relative max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          start(async () => {
            const res = await createDemand({
              groupId,
              description: String(f.get('description') ?? ''),
              messageId: initial?.messageId ?? null,
              type: String(f.get('type') ?? '') || null,
              assigneeId: String(f.get('assignee') ?? '') || null,
              // datetime-local está no fuso do navegador: converte aqui para não depender do fuso do servidor
              promisedAt: f.get('promised') ? new Date(String(f.get('promised'))).toISOString() : null,
            });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success('Demanda criada');
            onClose();
          });
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Nova demanda</h2>
            {initial?.messageId && <p className="text-xs text-muted">Vinculada à mensagem do cliente em {initial.groupName}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!initial?.groupId && (
          <Field label="Grupo">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
              <option value="">Selecione…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="O que o cliente pediu">
          <Textarea name="description" rows={3} required defaultValue={initial?.description ?? ''} maxLength={1000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select name="type" defaultValue="">
              <option value="">—</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável">
            <Select name="assignee" defaultValue="">
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Prazo prometido ao cliente (opcional)">
          <Input type="datetime-local" name="promised" />
        </Field>
        <div className="flex gap-2">
          <Button disabled={pending || !groupId}>{pending ? 'Criando…' : 'Criar demanda'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
