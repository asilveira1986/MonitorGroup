'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';

/** Busca de grupos: filtra enquanto digita; apagar o texto (ou o ×) limpa o filtro na hora. */
export function GroupSearch({ q, filter, tag = null }: { q: string; filter: string; tag?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (text: string) => {
    const p = new URLSearchParams();
    if (filter !== 'all') p.set('filter', filter);
    if (text.trim()) p.set('q', text.trim());
    if (tag) p.set('tag', tag);
    router.replace(p.size ? `${pathname}?${p}` : pathname);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <form
      className="relative w-full sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <Input
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          if (timer.current) clearTimeout(timer.current);
          // vazio: limpa já; digitando: espera uma pausa curta
          timer.current = setTimeout(() => go(text), text.trim() ? 350 : 0);
        }}
        placeholder="Buscar grupo…"
        aria-label="Buscar grupo"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue('');
            go('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-ink"
          aria-label="Limpar a busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
