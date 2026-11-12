'use client';

import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { findMatches, MIN_SEARCH_CHARS } from '@/lib/message-search';

export type SearchHit = { id: string; sent_at: string };

/**
 * Pesquisa dentro de uma conversa (grupo ou privado), como no WhatsApp: digita, vê "3 de 12", sobe/desce entre as
 * ocorrências (Enter = mais antiga, Shift+Enter = mais nova), e o trecho fica marcado na mensagem.
 * `ensureLoaded` carrega as mensagens que ainda não estão na tela (a pesquisa vai até o começo do histórico).
 */
export function ChatSearch({
  scope,
  chatId,
  containerRef,
  ensureLoaded,
  version,
  initial,
  onClose,
}: {
  scope: 'group' | 'private';
  chatId: string;
  /** onde ficam as mensagens (para marcar o texto achado) */
  containerRef: React.RefObject<HTMLElement | null>;
  ensureLoaded: (hit: SearchHit) => Promise<void>;
  /** muda quando chegam mensagens na tela (refaz a marcação) */
  version: number;
  /** começa já com este texto e posicionada nesta mensagem (vindo da pesquisa geral) */
  initial?: { term: string; messageId?: string | null };
  onClose: () => void;
}) {
  const [term, setTerm] = useState(initial?.term ?? '');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const wantId = useRef<string | null>(initial?.messageId ?? null);
  const active = term.trim().length >= MIN_SEARCH_CHARS;

  useEffect(() => inputRef.current?.focus(), []);

  // busca no banco (com uma pausa curta enquanto digita)
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const t = setTimeout(
      async () => {
        setState('loading');
        const supabase = createClient();
        const { data, error } =
          scope === 'group'
            ? await supabase.rpc('search_group_messages', { p_term: term.trim(), p_group: chatId, p_limit: 500 })
            : await supabase.rpc('search_private_messages', { p_term: term.trim(), p_chat: chatId, p_limit: 500 });
        if (!alive) return;
        if (error) return setState('error');
        const list = ((data ?? []) as SearchHit[]).map((r) => ({ id: r.id, sent_at: r.sent_at }));
        setHits(list);
        const want = wantId.current ? list.findIndex((h) => h.id === wantId.current) : -1;
        wantId.current = null;
        setIdx(want >= 0 ? want : 0);
        setState('idle');
      },
      initial && wantId.current ? 0 : 300,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // só quando o texto muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, scope, chatId, active]);

  const shownHits = active ? hits : [];
  const current = shownHits[idx] ?? null;

  // vai até a mensagem escolhida (carregando o trecho que falta) e a destaca
  useEffect(() => {
    if (!current) return;
    let alive = true;
    void (async () => {
      await ensureLoaded(current);
      if (!alive) return;
      requestAnimationFrame(() => {
        if (alive) document.getElementById(`msg-${current.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    })();
    return () => {
      alive = false;
    };
    // só quando a ocorrência atual muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // marca o texto achado nas mensagens da tela (Custom Highlight API; sem suporte, fica só o anel na mensagem atual)
  const mark = useCallback(() => {
    const root = containerRef.current;
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HL = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    document.querySelectorAll('[data-search-current]').forEach((el) => el.removeAttribute('data-search-current'));
    if (!root || !reg || !HL) return;
    reg.delete('chat-search');
    reg.delete('chat-search-current');
    if (!active) return;
    const all: Range[] = [];
    const cur: Range[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('[id^="msg-"]')) {
      const isCurrent = current ? el.id === `msg-${current.id}` : false;
      if (isCurrent) el.setAttribute('data-search-current', '');
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue ?? '';
        for (const m of findMatches(text, term)) {
          const r = document.createRange();
          r.setStart(n, m.start);
          r.setEnd(n, m.end);
          (isCurrent ? cur : all).push(r);
        }
      }
    }
    reg.set('chat-search', new HL(...all));
    reg.set('chat-search-current', new HL(...cur));
  }, [active, containerRef, current, term]);
  useEffect(() => {
    // depois que a tela desenhou as mensagens carregadas
    const t = setTimeout(mark, 60);
    return () => clearTimeout(t);
  }, [mark, version, shownHits.length]);
  useEffect(
    () => () => {
      const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
      reg?.delete('chat-search');
      reg?.delete('chat-search-current');
      document.querySelectorAll('[data-search-current]').forEach((el) => el.removeAttribute('data-search-current'));
    },
    [],
  );

  const older = () => shownHits.length && setIdx((i) => Math.min(i + 1, shownHits.length - 1));
  const newer = () => shownHits.length && setIdx((i) => Math.max(i - 1, 0));

  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" role="search">
      <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) newer();
            else older();
          }
        }}
        placeholder="Pesquisar nesta conversa"
        aria-label="Pesquisar nesta conversa"
        className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted sm:text-sm"
      />
      <span className="tabular shrink-0 text-xs text-muted" aria-live="polite">
        {!active
          ? ''
          : state === 'loading'
            ? ''
            : state === 'error'
              ? 'Pesquisa indisponível'
              : shownHits.length
                ? `${idx + 1} de ${shownHits.length}${shownHits.length >= 500 ? '+' : ''}`
                : 'Nada encontrado'}
      </span>
      {state === 'loading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-label="Pesquisando" />}
      <button type="button" onClick={older} disabled={!shownHits.length || idx >= shownHits.length - 1} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-40" aria-label="Ocorrência mais antiga" title="Mais antiga (Enter)">
        <ChevronUp className="h-4 w-4" />
      </button>
      <button type="button" onClick={newer} disabled={!shownHits.length || idx <= 0} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-40" aria-label="Ocorrência mais nova" title="Mais nova (Shift+Enter)">
        <ChevronDown className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar pesquisa" title="Fechar (Esc)">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
