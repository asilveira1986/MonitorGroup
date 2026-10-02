'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/format';

/** Mostra há quanto tempo o cliente está esperando, atualizando a cada 30s. */
export function LiveTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="tabular" suppressHydrationWarning>
      {formatDuration((now - new Date(since).getTime()) / 1000)}
    </span>
  );
}
