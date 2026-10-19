'use client';

import { Crown, Headset, Search, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, CardHeader } from '@/components/ui';
import { Avatar } from '@/components/avatar';
import { cn, formatPhone, timeAgo } from '@/lib/format';

export type GroupMember = {
  jid: string;
  phone: string | null;
  name: string | null;
  role: 'member' | 'admin' | 'superadmin';
  team: boolean;
  is_me: boolean;
  messages_30d: number;
  last_message_at: string | null;
  joined_at: string;
  /** o worker guardou a foto de perfil */
  has_avatar?: boolean;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

/**
 * Membros do grupo (lista do próprio WhatsApp, atualizada pelo worker quando alguém entra ou sai):
 * nome, telefone, admin do grupo, se é da equipe e a atividade dos últimos 30 dias.
 */
export function GroupMembers({ members, total }: { members: GroupMember[]; total: number }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const shown = members.filter(
    (m) => !q || (m.name ?? '').toLowerCase().includes(q) || (digits && (m.phone ?? '').includes(digits)),
  );
  const team = members.filter((m) => m.team).length;
  const others = members.filter((m) => !m.team && !m.is_me).length;
  const silent = members.filter((m) => !m.messages_30d && !m.is_me).length;

  return (
    <Card>
      <CardHeader
        title={`Membros (${members.length || total})`}
        description={
          members.length
            ? `${team} da equipe · ${others} clientes e outros · ${silent} sem mensagens em 30 dias`
            : 'A lista aparece depois que o WhatsApp conectado sincronizar o grupo.'
        }
      />
      {members.length > 0 && (
        <div className="px-3 pb-3">
          {members.length > 6 && (
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nome ou telefone"
                aria-label="Buscar membro"
                className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-xs outline-none focus:border-brand-line"
              />
            </label>
          )}
          <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto">
            {shown.map((m) => {
              const label = m.is_me ? 'Número conectado' : m.name || formatPhone(m.phone) || 'Sem nome';
              return (
                <li key={m.jid} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-2/60">
                  <Avatar
                    jid={m.jid}
                    hasPhoto={m.has_avatar}
                    name={m.name || label}
                    expandable
                    subtitle={m.phone ? formatPhone(m.phone) : undefined}
                    className={cn(
                      'h-8 w-8 rounded-full text-[11px]',
                      m.team || m.is_me ? 'bg-deep text-on-deep' : 'bg-brand-soft text-brand-text',
                    )}
                    fallback={
                      m.is_me ? <Smartphone className="h-3.5 w-3.5" /> : initials(m.name || label) || <Users className="h-3.5 w-3.5" />
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-medium">
                      <span className="truncate">{label}</span>
                      {m.role === 'superadmin' && <Crown className="h-3.5 w-3.5 shrink-0 text-warning-ink" aria-label="Criador do grupo" />}
                      {m.role === 'admin' && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-text" aria-label="Admin do grupo" />}
                    </p>
                    <p className="truncate text-[11px] text-muted" suppressHydrationWarning>
                      {m.phone && (m.name || m.is_me) ? `${formatPhone(m.phone)} · ` : ''}
                      {m.messages_30d
                        ? `${m.messages_30d} msg em 30 dias · última ${timeAgo(m.last_message_at)}`
                        : m.is_me
                          ? 'monitora o grupo'
                          : 'sem mensagens em 30 dias'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {m.team && (
                      <Badge tone="brand">
                        <Headset className="h-3 w-3" /> Equipe
                      </Badge>
                    )}
                    {m.role !== 'member' && !m.team && (
                      <span className="text-[10px] text-muted">{m.role === 'superadmin' ? 'criador' : 'admin'}</span>
                    )}
                  </div>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">Ninguém com esse nome ou telefone.</li>}
          </ul>
        </div>
      )}
    </Card>
  );
}
