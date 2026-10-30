'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Recarrega os números da tela de tempos em tempos (só com a aba visível). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
