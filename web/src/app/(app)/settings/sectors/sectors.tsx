'use client';

import { BellRing, Building2, ClipboardList, MessageSquareReply, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { cn } from '@/lib/format';
import { createSector, deleteSector, saveSector, setDefaultSector, type SectorInput } from '../actions';
import { Row } from '../demand-settings';

export type SectorRow = SectorInput & { id: string };
type Person = { id: string; name: string; email: string; admin: boolean; active: boolean };
type GroupOption = { id: string; name: string; monitored: boolean; sectorId: string | null };

const EMPTY: SectorInput = { name: '', description: '', can_reply: true, can_manage_demands: true, can_handle_alerts: true };

/** Permissões do setor (ver grupos e conversas é a base de todo setor). */
function Permissions({
  value,
  onChange,
  disabled,
}: {
  value: SectorInput;
  onChange: (v: SectorInput) => void;
  disabled: boolean;
}) {
  return (
    <div className="divide-y divide-line">
      {/* responder: todos os usuários respondem nos grupos que veem (0094), não é mais por setor */}
      <div className="flex items-start gap-3 py-3 text-xs text-ink-2">
        <MessageSquareReply className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
        <p>
          <span className="block text-sm font-medium text-ink">Responder pelo sistema</span>
          Todos os usuários respondem nos grupos que veem (menos o perfil “só visualizar”).
        </p>
      </div>
      <Row
        icon={ClipboardList}
        title="Gerenciar demandas"
        text="Criar demandas e alterar status, responsável e prazo nos grupos do setor."
        checked={value.can_manage_demands}
        onChange={(v) => onChange({ ...value, can_manage_demands: v })}
        disabled={disabled}
      />
      <Row
        icon={BellRing}
        title="Tratar alertas"
        text="Reconhecer e resolver alertas dos grupos do setor."
        checked={value.can_handle_alerts}
        onChange={(v) => onChange({ ...value, can_handle_alerts: v })}
        disabled={disabled}
      />
    </div>
  );
}

export function DefaultSector({ sectors, value }: { sectors: SectorRow[]; value: string | null }) {
  const [current, setCurrent] = useState(value ?? '');
  const [pending, start] = useTransition();
  return (
    <Select
      value={current}
      disabled={pending}
      aria-label="Setor dos grupos novos"
      onChange={(e) => {
        const next = e.target.value;
        const prev = current;
        setCurrent(next);
        start(async () => {
          const res = await setDefaultSector(next || null);
          if (!res.ok) {
            setCurrent(prev);
            toast.error(res.error);
          } else toast.success('Setor dos grupos novos salvo');
        });
      }}
    >
      <option value="">Nenhum (só administradores veem até definir)</option>
      {sectors.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

/** Lista de setores (cadastro simples): nome, quantas pessoas e grupos; editar abre a janela do setor. */
export function SectorsList({
  sectors,
  users,
  members,
  groups,
  defaultSectorId,
}: {
  sectors: SectorRow[];
  users: Person[];
  members: { sector_id: string; user_id: string }[];
  groups: GroupOption[];
  defaultSectorId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const membersOf = (id: string) => members.filter((m) => m.sector_id === id).map((m) => m.user_id);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const current = sectors.find((s) => s.id === editing) ?? null;
  const create = () =>
    start(async () => {
      const res = await createSector({ ...EMPTY, name });
      if (!res.ok) return void toast.error(res.error);
      setName('');
      router.refresh();
      if (res.id) setEditing(res.id);
    });

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <p className="font-semibold">Setores</p>
          <p className="text-xs text-ink-2">Cada grupo fica num setor; as pessoas do setor veem e atendem esses grupos. Na Agenda, o setor marca todos de uma vez.</p>
        </div>
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do novo setor" aria-label="Nome do novo setor" className="sm:w-56" maxLength={80} />
          <Button type="submit" size="sm" disabled={pending || !name.trim()} className="shrink-0">
            <Plus className="h-3.5 w-3.5" /> Criar
          </Button>
        </form>
      </div>
      <ul className="mt-4 divide-y divide-line border-t border-line">
        {sectors.map((s) => {
          const ids = membersOf(s.id);
          const count = groups.filter((g) => g.sectorId === s.id).length;
          const names = ids.map((id) => nameOf.get(id)).filter(Boolean) as string[];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                <Building2 className="h-4 w-4" />
              </span>
              <button type="button" onClick={() => setEditing(s.id)} className="min-w-0 flex-1 basis-48 text-left">
                <p className="truncate text-sm font-medium hover:underline">
                  {s.name}
                  {defaultSectorId === s.id && <span className="ml-2 text-[11px] font-normal text-muted">recebe os grupos novos (de número sem setor)</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {ids.length} pessoa(s) · {count} grupo(s)
                  {names.length > 0 && ` · ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}`}
                </p>
              </button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(s.id)}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Excluir o setor "${s.name}"? Os grupos dele ficam sem setor (só administradores veem).`)) return;
                  start(async () => {
                    const res = await deleteSector(s.id);
                    if (res.ok) toast.success('Setor excluído');
                    else toast.error(res.error);
                    router.refresh();
                  });
                }}
                className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 hover:text-critical-ink"
                aria-label={`Excluir ${s.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {sectors.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-muted">Nenhum setor ainda. Enquanto não houver setores, só administradores veem os grupos.</li>
        )}
      </ul>
      {current && (
        <SectorDialog
          key={current.id}
          sector={current}
          users={users}
          memberIds={membersOf(current.id)}
          groups={groups}
          sectorNames={Object.fromEntries(sectors.map((x) => [x.id, x.name]))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Janela do setor: nome, pessoas e grupos (as permissões ficam em "Mais opções"). */
function SectorDialog({
  sector,
  users,
  memberIds,
  groups,
  sectorNames,
  onClose,
}: {
  sector: SectorRow;
  users: Person[];
  memberIds: string[];
  groups: GroupOption[];
  sectorNames: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<SectorInput>({ ...sector, description: sector.description ?? '' });
  const [members, setMembers] = useState(() => new Set(memberIds));
  const [chosen, setChosen] = useState(() => new Set(groups.filter((g) => g.sectorId === sector.id).map((g) => g.id)));
  const [tab, setTab] = useState<'people' | 'groups'>('people');
  const [query, setQuery] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const agents = users.filter((u) => !u.admin);
  const shownPeople = agents.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const shownGroups = useMemo(
    () =>
      groups
        .filter((g) => !q || g.name.toLowerCase().includes(q))
        // os do setor primeiro (a ordem só muda ao buscar, não "pula" enquanto marca)
        .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, q],
  );
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const save = () =>
    start(async () => {
      const initialMembers = new Set(memberIds);
      const initialGroups = new Set(groups.filter((g) => g.sectorId === sector.id).map((g) => g.id));
      const res = await saveSector(sector.id, {
        ...value,
        addMembers: [...members].filter((x) => !initialMembers.has(x)),
        removeMembers: [...initialMembers].filter((x) => !members.has(x)),
        addGroups: [...chosen].filter((x) => !initialGroups.has(x)),
        removeGroups: [...initialGroups].filter((x) => !chosen.has(x)),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Setor ${value.name} salvo`);
      router.refresh();
      onClose();
    });
  const tabBtn = (k: 'people' | 'groups', label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(k);
        setQuery('');
      }}
      className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', tab === k ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}
    >
      {label}
    </button>
  );
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Setor ${sector.name}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface text-ink shadow-2xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} aria-label="Nome do setor" className="h-9 flex-1 font-semibold" maxLength={80} />
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 px-4 pt-3">
          <div className="inline-flex rounded-xl border border-line p-1">
            {tabBtn('people', `Pessoas (${members.size})`)}
            {tabBtn('groups', `Grupos (${chosen.size})`)}
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              className="h-9 pl-9"
              placeholder={tab === 'people' ? 'Buscar pessoa' : 'Buscar grupo'}
              aria-label={tab === 'people' ? 'Buscar pessoa' : 'Buscar grupo'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <ul className="mx-4 my-2 min-h-40 flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
          {tab === 'people'
            ? shownPeople.map((u) => (
                <li key={u.id}>
                  <label className={item}>
                    <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={members.has(u.id)} onChange={() => toggle(members, u.id, setMembers)} />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {!u.active && <Badge tone="critical">sem acesso</Badge>}
                    <span className="hidden truncate text-xs text-muted sm:inline">{u.email}</span>
                  </label>
                </li>
              ))
            : shownGroups.map((g) => {
                const other = g.sectorId && g.sectorId !== sector.id ? sectorNames[g.sectorId] : null;
                const checked = chosen.has(g.id);
                return (
                  <li key={g.id}>
                    <label className={item}>
                      <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={checked} onChange={() => toggle(chosen, g.id, setChosen)} />
                      <span className={cn('min-w-0 flex-1 truncate', !g.monitored && 'text-muted')}>{g.name}</span>
                      {other && (
                        <span className={cn('shrink-0 text-[11px]', checked ? 'text-warning-ink' : 'text-muted')} title={checked ? `Ao salvar, sai do setor ${other}` : `Hoje no setor ${other}`}>
                          {checked ? `sai de ${other}` : other}
                        </span>
                      )}
                      {!g.sectorId && !checked && <span className="shrink-0 text-[11px] text-warning-ink">sem setor</span>}
                    </label>
                  </li>
                );
              })}
          {(tab === 'people' ? shownPeople : shownGroups).length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted">{tab === 'people' ? 'Nenhuma pessoa (administradores já veem tudo).' : 'Nenhum grupo encontrado.'}</li>
          )}
        </ul>
        <p className="px-4 text-[11px] text-muted">
          {tab === 'people' ? 'Administradores não aparecem: já veem todos os grupos.' : 'Cada grupo fica num setor só: marcar aqui tira o grupo do setor anterior.'}
        </p>
        <details className="mx-4 mt-2 rounded-xl border border-line px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-ink-2">Mais opções (permissões)</summary>
          <Permissions value={value} onChange={setValue} disabled={pending} />
        </details>
        <div className="mt-3 flex gap-2 border-t border-line px-4 py-3">
          <Button size="sm" disabled={pending || !value.name.trim()} onClick={save}>
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
