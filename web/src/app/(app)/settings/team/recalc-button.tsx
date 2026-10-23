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
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Revisa todas as mensagens, desde a primeira: separa o que é do cliente e o que é da equipe e tira de “aguardando resposta” os grupos já respondidos (também roda sozinho ao adicionar alguém)."
      onClick={() =>
        start(async () => {
          const res = await recalcGroups();
          if (!res.ok) return void toast.error(res.error);
          const s = res.summary;
          toast.success('Grupos recalculados', {
            description: s
              ? `${s.mensagens_da_equipe ?? s.mensagens_reclassificadas} mensagem(ns) passaram a ser da equipe${s.mensagens_de_cliente ? ` · ${s.mensagens_de_cliente} voltaram a ser do cliente` : ''} · aguardando resposta: ${s.aguardando_antes} → ${s.aguardando_depois} · ${s.alertas_resolvidos} alerta(s) resolvido(s)`
              : undefined,
            duration: 10_000,
          });
        })
      }
    >
      <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      {pending ? 'Recalculando…' : 'Recalcular'}
    </Button>
  );
}
