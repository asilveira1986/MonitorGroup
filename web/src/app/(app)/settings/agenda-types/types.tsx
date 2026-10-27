'use client';

import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, EmptyState, Input } from '@/components/ui';
import { AGENDA_COLORS, type AgendaColor, type AgendaType } from '@/lib/agenda-colors';
import { deleteAgendaType, saveAgendaType } from './actions';

function TypeEditor({ type, onDone }: { type: AgendaType | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(type?.name ?? '');
  const [color, setColor] = useState<AgendaColor>(type?.color ?? 'blue');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-brand-soft/30 p-4">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do tipo (ex.: Reunião, Audiência, Prazo)" maxLength={60} autoFocus />
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
              const res = await saveAgendaType(type?.id ?? null, name, color);
              if (!res.ok) return void toast.error(res.error);
              toast.success('Tipo de compromisso salvo');
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

export function AgendaTypes({ types, usage }: { types: AgendaType[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Tipos de compromisso"
        description="Cada tipo tem uma cor: na agenda, o compromisso aparece com a cor do tipo escolhido."
        action={
          editing !== 'new' && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Novo tipo
            </Button>
          )
        }
      />
      <div className="space-y-2 p-5">
        {editing === 'new' && <TypeEditor type={null} onDone={() => setEditing(null)} />}
        {types.length === 0 && editing !== 'new' && <EmptyState icon={<Tag />} title="Nenhum tipo" description="Crie tipos (Reunião, Audiência...) para colorir a agenda." />}
        {types.map((t) =>
          editing === t.id ? (
            <TypeEditor key={t.id} type={t} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: AGENDA_COLORS[t.color]?.hex }} aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {t.name} <span className="font-normal text-muted">· {usage[t.id] ?? 0} compromisso(s)</span>
              </p>
              <button type="button" onClick={() => setEditing(t.id)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Editar ${t.name}`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  confirm(`Excluir o tipo "${t.name}"? Os compromissos dele continuam, sem tipo.`) &&
                  start(async () => {
                    const res = await deleteAgendaType(t.id);
                    if (!res.ok) return void toast.error(res.error);
                    toast.success('Tipo excluído');
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
