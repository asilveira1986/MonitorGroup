'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Atualização programada do Dashboard e do Modo TV: só nas horas pares entre 06h e 22h
 * (06h, 08h, 10h ... 22h, no horário do navegador). Fora dessa janela a tela não se atualiza
 * sozinha. Cada atualização é uma função na Vercel, por isso nada de atualizar a cada mensagem.
 *
 * A conferência roda só no navegador (a cada minuto, sem chamar o servidor) e usa o horário do
 * relógio, então funciona mesmo se o computador ou a TV hibernar e voltar depois.
 */
const FIRST_HOUR = 6;
const LAST_HOUR = 22;
const EVERY_HOURS = 2;

/** Último horário programado já alcançado hoje (ex.: "2026-11-08T10"), ou null antes das 06h. */
function currentSlot(now = new Date()): string | null {
  const h = now.getHours();
  if (h < FIRST_HOUR) return null;
  const slotHour = Math.min(LAST_HOUR, FIRST_HOUR + Math.floor((h - FIRST_HOUR) / EVERY_HOURS) * EVERY_HOURS);
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${day}T${String(slotHour).padStart(2, '0')}`;
}

export function useScheduledRefresh() {
  const router = useRouter();
  useEffect(() => {
    // a tela acabou de carregar com dados atuais: conta como feita a atualização do horário atual
    let done = currentSlot();
    const check = () => {
      const slot = currentSlot();
      if (slot && slot !== done) {
        done = slot;
        router.refresh();
      }
    };
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [router]);
}

/** Para usar dentro de páginas do servidor (ex.: Dashboard). */
export function ScheduledRefresh() {
  useScheduledRefresh();
  return null;
}
