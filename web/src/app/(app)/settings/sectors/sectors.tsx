'use client';

import { BellRing, Building2, ClipboardList, MessageSquareReply, Plus, Save, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, Select, Textarea } from '@/components/ui';
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
      <Row
        icon={MessageSquareReply}
        title="Responder pelo sistema"
        text="Enviar mensagens pelo painel nos grupos do setor (se responder pelo sistema estiver ligado em Geral)."
        checked={value.can_reply}
        onChange={(v) => onChange({ ...value, can_reply: v })}
        disabled={disabled}
      />
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

export function NewSectorForm() {
  const [value, setValue] = useState<SectorInput>(EMPTY);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createSector(value);
          if (res.ok) {
            toast.success('Setor criado. Agora marque os usuários e os grupos dele.');
            setValue(EMPTY);
          } else toast.error(res.error);
        });
      }}
    >
      <Input
        placeholder="Nome do setor"
        aria-label="Nome do setor"
        value={value.name}
        onChange={(e) => setValue({ ...value, name: e.target.value })}
        disabled={pending}
        required
      />
      <Textarea
        rows={2}
        placeholder="Descrição (opcional)"
        aria-label="Descrição do setor"
        value={value.description}
        onChange={(e) => setValue({ ...value, description: e.target.value })}
        disabled={pending}
      />
      <Permissions value={value} onChange={setValue} disabled={pending} />
      <Button type="submit" size="sm" disabled={pending || !value.name.trim()}>
        <Plus className="h-3.5 w-3.5" /> Criar setor
      </Button>
    </form>
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

/** Um setor: nome, permissões, usuários e grupos. */
export function SectorEditor({
  sector,
  users,
  memberIds,
  groups,
  sectorNames,
  isDefault,
}: {
  sector: SectorRow;
  users: Person[];
  memberIds: string[];
  groups: GroupOption[];
  sectorNames: Record<string, string>;
  isDefault: boolean;
}) {
  const [value, setValue] = useState<SectorInput>({ ...sector, description: sector.description ?? '' });
  const [members, setMembers] = useState(() => new Set(memberIds));
  const [chosen, setChosen] = useState(() => new Set(groups.filter((g) => g.sectorId === sector.id).map((g) => g.id)));
  const [query, setQuery] = useState('');
  const [pending, start] = useTransition();

  const q = query.trim().toLowerCase();
  const shownGroups = useMemo(
    () =>
      groups
        .filter((g) => !q || g.name.toLowerCase().includes(q))
        // os do setor primeiro
        .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name)),
    // a ordem só muda ao buscar (não "pula" enquanto marca)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, q],
  );
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const agents = users.filter((u) => !u.admin);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{sector.name}</p>
            <p className="text-xs text-muted">
              {members.size} usuário(s) · {chosen.size} grupo(s)
              {isDefault && ' · recebe os grupos novos'}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Excluir o setor "${sector.name}"? Os grupos dele ficam sem setor (só administradores veem).`)) return;
            start(async () => {
              const res = await deleteSector(sector.id);
              if (res.ok) toast.success('Setor excluído');
              else toast.error(res.error);
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Excluir
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <Input
            aria-label="Nome do setor"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            disabled={pending}
          />
          <Textarea
            rows={2}
            aria-label="Descrição do setor"
            placeholder="Descrição (opcional)"
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            disabled={pending}
          />
          <Permissions value={value} onChange={setValue} disabled={pending} />

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4 text-muted" /> Usuários do setor
            </p>
            {agents.length === 0 ? (
              <p className="text-xs text-muted">Nenhum atendente cadastrado. Administradores já veem tudo.</p>
            ) : (
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
                {agents.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--brand)]"
                        checked={members.has(u.id)}
                        onChange={() => toggle(members, u.id, setMembers)}
                        disabled={pending}
                      />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {!u.active && <Badge tone="critical">sem acesso</Badge>}
                      <span className="hidden truncate text-xs text-muted sm:inline">{u.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[11px] text-muted">Administradores não aparecem aqui: eles já veem todos os grupos.</p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium">
            <span>Grupos do setor</span>
            <span className="text-xs font-normal text-muted">{chosen.size} marcado(s)</span>
          </p>
          <label className="relative mb-1.5 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              className="pl-9"
              placeholder="Buscar grupo"
              aria-label={`Buscar grupo para ${sector.name}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul className="max-h-[22rem] space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
            {shownGroups.map((g) => {
              const other = g.sectorId && g.sectorId !== sector.id ? sectorNames[g.sectorId] : null;
              const checked = chosen.has(g.id);
              return (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--brand)]"
                      checked={checked}
                      onChange={() => toggle(chosen, g.id, setChosen)}
                      disabled={pending}
                    />
                    <span className={cn('min-w-0 flex-1 truncate', !g.monitored && 'text-muted')}>{g.name}</span>
                    {other && (
                      <span
                        className={cn('shrink-0 text-[11px]', checked ? 'text-warning-ink' : 'text-muted')}
                        title={checked ? `Ao salvar, sai do setor ${other}` : `Hoje no setor ${other}`}
                      >
                        {checked ? `sai de ${other}` : other}
                      </span>
                    )}
                    {!g.sectorId && !checked && <span className="shrink-0 text-[11px] text-warning-ink">sem setor</span>}
                  </label>
                </li>
              );
            })}
            {shownGroups.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">Nenhum grupo encontrado.</li>}
          </ul>
          <p className="mt-1 text-[11px] text-muted">Cada grupo pertence a um setor só: marcar aqui tira o grupo do setor anterior.</p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <Button
          size="sm"
          disabled={pending || !value.name.trim()}
          onClick={() =>
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
              if (res.ok) toast.success(`Setor ${value.name} salvo`);
              else toast.error(res.error);
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Salvar setor
        </Button>
      </div>
    </Card>
  );
}
