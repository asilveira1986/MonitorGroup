'use client';

import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, EmptyState, Input } from '@/components/ui';
import { deleteAgendaTeam, saveAgendaTeam } from './actions';

type Person = { id: string; name: string; role: string };
type Team = { id: string; name: string; userIds: string[] };

/** Um setor sendo criado/editado: nome e as pessoas marcadas. */
function TeamEditor({ team, people, onDone }: { team: Team | null; people: Person[]; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(team?.name ?? '');
  const [ids, setIds] = useState<string[]>(team?.userIds ?? []);
  const [pending, start] = useTransition();
  const has = new Set(ids);
  return (
    <div className="space-y-3 rounded-xl border border-brand-line bg-brand-soft/30 p-4">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do setor (ex.: Jurídico, Comercial, Diretoria)" maxLength={80} autoFocus />
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => setIds(people.map((p) => p.id))} className="text-brand-text hover:underline">
          marcar todos
        </button>
        <button type="button" onClick={() => setIds([])} className="text-ink-2 hover:underline">
          desmarcar todos
        </button>
      </div>
      <div className="grid max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-1 sm:grid-cols-2">
        {people.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <input
              type="checkbox"
              checked={has.has(p.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            <span className="truncate">{p.name}</span>
            {p.role === 'agenda' && <span className="text-[10px] text-muted">só agenda</span>}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveAgendaTeam(team?.id ?? null, name, ids);
              if (!res.ok) return void toast.error(res.error);
              toast.success('Setor da agenda salvo');
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

export function AgendaTeams({ teams, people }: { teams: Team[]; people: Person[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pending, start] = useTransition();
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return (
    <Card>
      <CardHeader
        title="Setores da agenda"
        description="Grupos de pessoas para marcar compromissos de uma vez: no novo compromisso, escolher o setor marca todos dele (e dá para desmarcar quem não vai). Não muda o que cada um vê nos grupos do WhatsApp."
        action={
          editing !== 'new' && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" /> Novo setor
            </Button>
          )
        }
      />
      <div className="space-y-3 p-5">
        {editing === 'new' && <TeamEditor team={null} people={people} onDone={() => setEditing(null)} />}
        {teams.length === 0 && editing !== 'new' && <EmptyState icon={<Users />} title="Nenhum setor da agenda" description="Crie um setor para marcar compromissos para várias pessoas de uma vez." />}
        {teams.map((t) =>
          editing === t.id ? (
            <TeamEditor key={t.id} team={t} people={people} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t.name} <span className="font-normal text-muted">· {t.userIds.length} pessoa(s)</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{t.userIds.map((id) => nameOf.get(id) ?? 'usuário').join(', ') || 'Ninguém'}</p>
              </div>
              <button type="button" onClick={() => setEditing(t.id)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Editar ${t.name}`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  confirm(`Excluir o setor da agenda "${t.name}"? Os compromissos já marcados continuam.`) &&
                  start(async () => {
                    const res = await deleteAgendaTeam(t.id);
                    if (!res.ok) return void toast.error(res.error);
                    toast.success('Setor excluído');
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
