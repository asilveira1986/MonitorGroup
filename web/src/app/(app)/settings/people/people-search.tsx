'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';

/** Busca no cadastro de pessoas: filtra enquanto digita (nome, e-mail, telefone, setor, perfil); apagar o texto limpa na hora. */
export function PeopleSearch({ q }: { q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (text: string) => {
    const t = text.trim();
    router.replace(t ? `${pathname}?q=${encodeURIComponent(t)}` : pathname, { scroll: false });
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <form
      className="relative w-full px-4 pb-3 pt-3 sm:px-5"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
    >
      <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted sm:left-8" aria-hidden />
      <Input
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(text), text.trim() ? 300 : 0);
        }}
        placeholder="Buscar por nome, e-mail, telefone, setor ou perfil…"
        aria-label="Buscar pessoa"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue('');
            go('');
          }}
          className="absolute right-7 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-ink sm:right-8"
          aria-label="Limpar a busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
