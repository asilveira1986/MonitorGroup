'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useRealtime } from '@/lib/use-realtime';

/**
 * Escuta novos alertas e mudanças nos grupos em tempo real e atualiza a tela
 * (os avisos em tela ficam no MessageNotifier).
 */
const MIN_INTERVAL_MS = 10_000;
// telas de indicadores (cálculo pesado no banco): no máximo uma vez por minuto
const HEAVY_PAGES = ['/dashboard', '/reports'];
const HEAVY_INTERVAL_MS = 60_000;

export function RealtimeListener() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // cada mensagem que chega atualiza o grupo: sem limite, a tela inteira era recarregada a cada
  // 1,5 s em empresas movimentadas, disputando com os cliques no menu. Agora: no máximo uma vez a
  // cada 10 s, e só com a aba visível (ao voltar para a aba, atualiza).
  const last = useRef(0);
  const missed = useRef(false);
  const refresh = () => {
    if (document.visibilityState !== 'visible') {
      missed.current = true;
      return;
    }
    if (timer.current) return;
    const heavy = HEAVY_PAGES.some((p) => window.location.pathname.startsWith(p));
    const wait = Math.max(1500, (heavy ? HEAVY_INTERVAL_MS : MIN_INTERVAL_MS) - (Date.now() - last.current));
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && missed.current) {
        missed.current = false;
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_indicators' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_indicator_blocks' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demands' }, refresh),
  );

  return null;
}
