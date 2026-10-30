'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/format';

/**
 * Quem está online agora: cada usuário logado entra num canal de presença da empresa (Supabase
 * Realtime) enquanto o sistema está aberto em alguma aba; ao fechar ou sair, sai do canal. Nada é
 * gravado no banco.
 */
const OnlineContext = createContext<Set<string>>(new Set());

export function PresenceProvider({ companyId, userId, children }: { companyId: string | null; userId: string; children: ReactNode }) {
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!companyId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase.channel(`online:${companyId}`, { config: { presence: { key: userId } } });
      channel
        .on('presence', { event: 'sync' }, () => {
          if (channel) setOnline(new Set(Object.keys(channel.presenceState())));
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED' && channel) void channel.track({ at: new Date().toISOString() });
        });
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [companyId, userId]);

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}

export const useOnline = () => useContext(OnlineContext);

/** Bolinha verde na foto de quem está online (o pai precisa ser "relative"). */
export function OnlineDot({ userId, className }: { userId: string | null | undefined; className?: string }) {
  const online = useOnline();
  if (!userId || !online.has(userId)) return null;
  return (
    <span
      className={cn('pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-good ring-2 ring-surface', className)}
      title="Online agora"
      aria-label="Online agora"
      role="img"
    />
  );
}
