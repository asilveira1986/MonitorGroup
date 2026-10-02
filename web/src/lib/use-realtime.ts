'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Assina um canal de tempo real do Supabase já autenticado com a sessão do
 * usuário (sem isso o canal entra como anônimo e o RLS bloqueia os eventos).
 */
export function useRealtime(name: string, configure: (channel: RealtimeChannel) => RealtimeChannel) {
  const configureRef = useRef(configure);
  useEffect(() => {
    configureRef.current = configure;
  });

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = configureRef.current(supabase.channel(name)).subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [name]);
}
