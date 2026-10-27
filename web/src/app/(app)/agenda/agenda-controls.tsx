'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DeliverButton as SharedDeliverButton } from '@/components/demands/deliver-button';
import { Select } from '@/components/ui';

/** "Demanda entregue" com observação para o cliente (componente das demandas). */
export function DeliverButton({ id, number }: { id: string; number: number }) {
  return <SharedDeliverButton id={id} number={number} size="sm" />;
}

/**
 * Administrador: de quem é a agenda mostrada — um usuário (?quem=) ou um setor da agenda inteiro
 * (?setor=, os compromissos de todos do setor). O primeiro seletor escolhe "Usuário" ou "Setor" e o
 * segundo lista os usuários ou os setores.
 */
export function PersonSelect({
  value,
  team = '',
  people,
  teams = [],
}: {
  value: string;
  team?: string;
  people: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'user' | 'team'>(team ? 'team' : 'user');
  const go = (key: 'quem' | 'setor', id: string) => {
    const next = new URLSearchParams(params);
    next.delete('quem');
    next.delete('setor');
    next.delete('pessoa');
    next.delete('dia');
    next.delete('evento');
    if (id) next.set(key, id);
    router.push(`/agenda${next.size ? `?${next}` : ''}`);
  };
  return (
    <div className="flex items-center gap-1.5">
      {teams.length > 0 && (
        <Select
          value={mode}
          aria-label="Ver por"
          className="h-9 w-auto text-sm"
          onChange={(e) => {
            const m = e.target.value as 'user' | 'team';
            setMode(m);
            // voltou para usuário: a própria agenda
            if (m === 'user' && team) go('quem', '');
          }}
        >
          <option value="user">Usuário</option>
          <option value="team">Setor</option>
        </Select>
      )}
      {mode === 'team' ? (
        <Select value={team} aria-label="Agenda do setor" className="h-9 w-52 text-sm" onChange={(e) => go('setor', e.target.value)}>
          <option value="" disabled>
            Escolha o setor
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ) : (
        <Select value={value} aria-label="Agenda de" className="h-9 w-52 text-sm" onChange={(e) => go('quem', e.target.value)}>
          <option value="">Minha agenda</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
