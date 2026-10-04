'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { Alert } from '@/lib/types';
import { useRealtime } from '@/lib/use-realtime';

/**
 * Escuta novos alertas e mudanças nos grupos em tempo real:
 * mostra uma notificação e atualiza a tela.
 */
export function RealtimeListener() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 1500);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useRealtime('app-realtime', (channel) =>
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        const alert = payload.new as Alert;
        const show = alert.severity === 'critical' ? toast.error : alert.severity === 'warning' ? toast.warning : toast.info;
        show(alert.title, {
          description: alert.description?.slice(0, 140),
          action: { label: 'Ver', onClick: () => router.push('/alerts') },
          duration: 10_000,
        });
        refresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups' }, refresh)
      // configuração de indicadores alterada por um admin: vale na hora para todos
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'indicators' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'indicator_blocks' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demands' }, refresh),
  );

  return null;
}
