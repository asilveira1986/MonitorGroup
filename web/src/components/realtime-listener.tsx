'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useRealtime } from '@/lib/use-realtime';

/**
 * Escuta novos alertas e mudanças nos grupos em tempo real e atualiza a tela
 * (os avisos em tela ficam no MessageNotifier).
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
      // alertas novos abrem no centro da tela (MessageNotifier); aqui só atualizam os contadores
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, refresh)
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
