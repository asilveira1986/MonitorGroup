'use client';

import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { recalcGroups } from '../actions';

/** Reclassifica as mensagens da equipe e atualiza os grupos já respondidos. */
export function RecalcButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await recalcGroups();
          if (!res.ok) return void toast.error(res.error);
          const s = res.summary;
          toast.success('Grupos recalculados', {
            description: s
              ? `${s.mensagens_reclassificadas} mensagem(ns) passaram a ser da equipe · aguardando resposta: ${s.aguardando_antes} → ${s.aguardando_depois} · ${s.alertas_resolvidos} alerta(s) resolvido(s)`
              : undefined,
            duration: 10_000,
          });
        })
      }
    >
      <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      {pending ? 'Recalculando…' : 'Recalcular grupos'}
    </Button>
  );
}
