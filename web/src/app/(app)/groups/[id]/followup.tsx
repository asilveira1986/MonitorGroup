'use client';

import { CheckCheck, ListTodo, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn, formatDateTime } from '@/lib/format';
import { followupBadge, type FollowupInfo } from '@/lib/followup-view';
import { dismissGroupFollowup } from '../followup-actions';

/**
 * Pendência da conversa por regras (0167), em cima da conversa do grupo: com quem ficou a próxima ação, o porquê (o
 * trecho da mensagem) e o prazo citado. "Não está pendente" corrige à mão quando a regra errou.
 */
export function FollowupBar({
  groupId,
  info,
  canEdit,
  timeZone,
  messageAt,
}: {
  groupId: string;
  info: FollowupInfo;
  canEdit: boolean;
  timeZone?: string;
  /** quando a mensagem do trecho foi enviada (a pendência pode ter começado antes, numa mensagem mais antiga) */
  messageAt?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // hora de referência para o "prazo vencido" (a página recarrega sozinha a cada mensagem nova)
  const [now] = useState(() => Date.now());
  const fmt = (iso: string) => formatDateTime(iso, timeZone);
  const b = followupBadge(info, now, fmt);
  if (!b) return null;
  const dismiss = async () => {
    setBusy(true);
    try {
      const res = await dismissGroupFollowup(groupId);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Pendência retirada. Novas mensagens voltam a contar.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(
        'mx-4 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-1.5 text-xs sm:mx-5',
        b.overdue ? 'border-critical/40 bg-critical/[0.07]' : b.side === 'company' ? 'border-warning/40 bg-warning/[0.07]' : 'border-brand-line bg-brand-soft/40',
      )}
      role="status"
      aria-label="Pendência da conversa"
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold',
          b.overdue ? 'bg-critical text-white' : b.side === 'company' ? 'bg-warning/20 text-warning-ink' : 'bg-brand-soft text-brand-text',
        )}
      >
        <ListTodo className="h-3 w-3" aria-hidden /> {b.label}
      </span>
      <span className="min-w-0 flex-1 text-ink-2">
        <span className="font-medium text-ink">{info.followup_reason}</span>
        {info.followup_excerpt && (
          <>
            {' · '}
            <span className="italic">“{info.followup_excerpt}”</span>
            {(info.followup_actor || messageAt) && (
              <>
                {' '}
                ({[info.followup_actor, messageAt ? fmt(messageAt) : info.followup_since ? fmt(info.followup_since) : null].filter(Boolean).join(', ')})
              </>
            )}
            {/* a pendência pode ter começado numa mensagem anterior sem resposta: a data do começo fica à parte */}
            {info.followup_since && messageAt && Math.abs(new Date(messageAt).getTime() - new Date(info.followup_since).getTime()) > 5 * 60_000 && (
              <span className="ml-1 whitespace-nowrap text-muted" title="A primeira mensagem do cliente que ficou sem resposta, antes desta">
                · sem resposta desde {fmt(info.followup_since)}
              </span>
            )}
            {info.followup_message_id && messageAt && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('group:jump', { detail: { id: info.followup_message_id, sent_at: messageAt } }))}
                className="ml-1.5 whitespace-nowrap font-medium text-brand-text underline-offset-2 hover:underline"
                title="Rolar a conversa até esta mensagem"
              >
                Ver mensagem
              </button>
            )}
          </>
        )}
        {info.followup_trigger && (
          <span className="ml-1 whitespace-nowrap text-muted" title="A frase da mensagem que disparou esta pendência. Se estiver errada, use Não está pendente.">
            · frase detectada: “{info.followup_trigger}”
          </span>
        )}
        {info.followup_due_at && (
          <span className={cn('ml-1 whitespace-nowrap', b.overdue && 'font-semibold text-critical-ink')}>
            · prazo {fmt(info.followup_due_at)}
            {b.overdue && ' (vencido)'}
          </span>
        )}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-[9px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
          title="A regra errou? Tira a pendência; as próximas mensagens voltam a contar."
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />} Não está pendente
        </button>
      )}
    </div>
  );
}
