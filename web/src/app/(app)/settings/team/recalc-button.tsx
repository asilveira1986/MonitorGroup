'use client';

import { RefreshCw } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import type { RecalcSummary } from '@/lib/recalc-groups';
import { recalcGroups, recalcGroupsBatch, recalcGroupsFinish, recalcGroupsStart } from '../actions';

const BATCH = 20;

/** Reclassifica as mensagens da equipe e atualiza os grupos já respondidos. */
export function RecalcButton() {
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  // em etapas (0132): cada chamada ao banco fica curta, mesmo com muitas mensagens
  const run = async (): Promise<{ ok: true; summary?: RecalcSummary } | { ok: false; error: string }> => {
    setProgress('mensagens…');
    const first = await recalcGroupsStart();
    if (!first.ok) return /0132/.test(first.error) ? recalcGroups() : first;
    let groups = 0;
    for (let i = 0; i < first.ids.length; i += BATCH) {
      setProgress(`grupos ${Math.min(i + BATCH, first.ids.length)}/${first.ids.length}`);
      const res = await recalcGroupsBatch(first.ids.slice(i, i + BATCH));
      if (!res.ok) return res;
      groups += res.done ?? 0;
    }
    setProgress('alertas…');
    return recalcGroupsFinish({ reclass: first.reclass, unmark: first.unmark, before: first.before, groups });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Revisa todas as mensagens, desde a primeira: separa o que é do cliente e o que é da equipe e tira de “aguardando resposta” os grupos já respondidos (também roda sozinho ao adicionar alguém)."
      onClick={() =>
        start(async () => {
          const res = await run();
          setProgress(null);
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
      {pending ? `Recalculando${progress ? ` (${progress})` : '…'}` : 'Recalcular'}
    </Button>
  );
}
