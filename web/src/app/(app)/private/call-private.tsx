'use client';

import { Loader2, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/format';
import { startPrivateChat } from './actions';

/**
 * "Chamar no privado": abre (ou acha) a conversa privada com alguém do grupo e vai para ela.
 * Usa o telefone quando se sabe; senão o identificador do WhatsApp (jid ou LID).
 */
export function CallPrivateButton({
  jid,
  phone,
  name,
  compact,
  className,
}: {
  jid: string | null;
  phone: string | null;
  name: string | null;
  /** só o ícone (cabeçalho das mensagens) */
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!jid && !phone) return null;
  const open = () =>
    start(async () => {
      const res = await startPrivateChat(phone ? { phone, name: name ?? undefined } : { jid: jid!, name: name ?? undefined });
      if (!res.ok) return void toast.error(res.error);
      router.push(`/private?c=${res.data!.id}`);
    });
  const label = `Chamar ${name || 'esta pessoa'} no privado`;
  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 rounded-full text-muted hover:bg-surface-2 hover:text-brand-text disabled:opacity-50',
        compact ? 'p-0.5' : 'px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
      {!compact && 'privado'}
    </button>
  );
}
