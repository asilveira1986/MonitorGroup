'use client';

import { Loader2, MessageCircle, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { formatPhone } from '@/lib/format';
import { startPrivateChat } from '@/app/(app)/private/actions';

export type ContactCard = { name: string | null; phone: string };

/**
 * Contatos compartilhados numa mensagem (grupo ou privado): clicar abre (ou acha) a conversa
 * privada com o contato e vai para ela. Sem poder usar o privado, só mostra o contato.
 */
export function ContactCards({ cards, canStart = true }: { cards: ContactCard[]; canStart?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!cards.length) return null;
  const open = (c: ContactCard) =>
    start(async () => {
      const res = await startPrivateChat({ phone: c.phone, name: c.name ?? undefined });
      if (!res.ok) return void toast.error(res.error);
      router.push(`/private?c=${res.data!.id}`);
    });
  return (
    <ul className="mb-1 space-y-1">
      {cards.map((c) => (
        <li key={c.phone}>
          <button
            type="button"
            onClick={() => open(c)}
            disabled={pending || !canStart}
            title={canStart ? `Iniciar conversa com ${c.name || formatPhone(c.phone)}` : undefined}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2 text-left text-sm transition enabled:hover:border-brand-line enabled:hover:bg-brand-soft/40 disabled:cursor-default"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
              <UserRound className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{c.name || formatPhone(c.phone)}</span>
              {c.name && <span className="block truncate text-xs text-ink-2">{formatPhone(c.phone)}</span>}
            </span>
            {canStart && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-text">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                Conversar
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
