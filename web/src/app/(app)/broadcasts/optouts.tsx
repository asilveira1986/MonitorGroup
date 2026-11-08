'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui';
import type { OptOut } from '@/lib/broadcast';
import { formatDateTime, formatPhone } from '@/lib/format';
import { addBroadcastOptout, removeBroadcastOptout } from './actions';

/** Quem não recebe disparos: respondeu "SAIR" ou foi cadastrado à mão. Fica fora de todos os públicos. */
export function Optouts({ items }: { items: OptOut[] }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const r = await addBroadcastOptout(phone, name);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPhone('');
      setName('');
      toast.success('Número adicionado à lista de quem não recebe.');
    });

  const remove = (o: OptOut) => {
    if (!confirm(`Voltar a incluir ${o.name || formatPhone(o.phone)} nos disparos?`)) return;
    start(async () => {
      const r = await removeBroadcastOptout(o.id);
      if (!r.ok) toast.error(r.error);
    });
  };

  return (
    <Card>
      <CardHeader
        title="Quem não recebe"
        description="Quem responde SAIR a um disparo entra aqui sozinho e fica fora de todos os públicos. Você também pode cadastrar à mão."
      />
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone com DDD" className="max-w-52" inputMode="tel" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (opcional)" className="max-w-52" />
          <Button variant="secondary" onClick={add} disabled={pending || !phone.trim()}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Ninguém na lista.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line/80">
            {items.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {o.name || formatPhone(o.phone)}
                  {o.name && <span className="ml-2 text-xs text-muted">{formatPhone(o.phone)}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={o.source === 'reply' ? 'warning' : 'neutral'}>{o.source === 'reply' ? 'Respondeu SAIR' : 'Cadastrado'}</Badge>
                  <span className="hidden text-xs text-muted sm:inline">{formatDateTime(o.created_at)}</span>
                  <button type="button" onClick={() => remove(o)} disabled={pending} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label="Voltar a incluir nos disparos">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
