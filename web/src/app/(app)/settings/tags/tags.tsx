'use client';

import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, EmptyState, Input } from '@/components/ui';
import type { CustomerTag } from '@/components/customer-tags';
import { AGENDA_COLORS, type AgendaColor } from '@/lib/agenda-colors';
import { deleteCustomerTag, saveCustomerTag } from './actions';

function TagEditorRow({ type, onDone }: { type: CustomerTag | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(type?.name ?? '');
  const [color, setColor] = useState<AgendaColor>(type?.color ?? 'blue');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-brand-soft/30 p-4">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da etiqueta (ex.: VIP, Inadimplente, Novo cliente)" maxLength={40} autoFocus />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor">
        {(Object.keys(AGENDA_COLORS) as AgendaColor[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            title={AGENDA_COLORS[c].label}
            onClick={() => setColor(c)}
            className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition ${color === c ? 'ring-2 ring-ink' : 'hover:scale-110'}`}
            style={{ backgroundColor: AGENDA_COLORS[c].hex }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveCustomerTag(type?.id ?? null, name, color);
              if (!res.ok) return void toast.error(res.error);
              toast.success('Etiqueta salva');
              router.refresh();
              onDone();
            })
          }
        >
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function CustomerTags({ types, usage }: { types: CustomerTag[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Etiquetas de clientes"
        description="Etiquetas para marcar os clientes nos grupos e nas conversas privadas (VIP, Inadimplente...). Quem atende também cria uma etiqueta nova na hora de etiquetar; aqui você renomeia, troca a cor e exclui."
        action={
          editing !== 'new' && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Nova etiqueta
            </Button>
          )
        }
      />
      <div className="space-y-2 p-5">
        {editing === 'new' && <TagEditorRow type={null} onDone={() => setEditing(null)} />}
        {types.length === 0 && editing !== 'new' && <EmptyState icon={<Tag />} title="Nenhuma etiqueta" description="Crie etiquetas para marcar os clientes (VIP, Inadimplente, Novo cliente...)." />}
        {types.map((t) =>
          editing === t.id ? (
            <TagEditorRow key={t.id} type={t} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: AGENDA_COLORS[t.color]?.hex }} aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {t.name} <span className="font-normal text-muted">· {usage[t.id] ?? 0} cliente(s)</span>
              </p>
              <button type="button" onClick={() => setEditing(t.id)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Editar ${t.name}`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  confirm(`Excluir a etiqueta "${t.name}"? Ela sai de todos os grupos e conversas.`) &&
                  start(async () => {
                    const res = await deleteCustomerTag(t.id);
                    if (!res.ok) return void toast.error(res.error);
                    toast.success('Etiqueta excluída');
                    router.refresh();
                  })
                }
                className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 hover:text-critical-ink"
                aria-label={`Excluir ${t.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
