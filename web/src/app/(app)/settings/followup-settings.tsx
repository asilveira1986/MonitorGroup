'use client';

import { ListTodo, RotateCcw, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Textarea } from '@/components/ui';
import { DEFAULT_DELIVERY_PHRASES, DEFAULT_REQUEST_PHRASES } from '@/lib/followup-phrases';
import type { AppSettings } from '@/lib/types';
import { saveFollowupSettings } from './actions/replies';
import { Row } from './demand-settings';

const split = (text: string) => text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean);

/**
 * Pendência da conversa por regras (0167): o sistema lê a conversa e diz se a próxima ação é da empresa (pergunta sem
 * resposta, promessa sem entrega) ou do cliente (a equipe pediu algo). Sem IA, sem custo.
 */
export function FollowupSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [enabled, setEnabled] = useState(settings.followup_enabled !== false);
  const [requests, setRequests] = useState((settings.followup_request_phrases?.length ? settings.followup_request_phrases : DEFAULT_REQUEST_PHRASES).join(', '));
  const [deliveries, setDeliveries] = useState((settings.followup_delivery_phrases?.length ? settings.followup_delivery_phrases : DEFAULT_DELIVERY_PHRASES).join(', '));
  const [pending, start] = useTransition();
  const lock = disabled || pending;

  return (
    <Card>
      <CardHeader
        title="Pendências da conversa"
        description='Lê as últimas mensagens de cada grupo e mostra com quem ficou a próxima ação: "Pendente empresa" ou "Pendente cliente". Aparece no Painel de grupos (etiqueta e filtro) e em cima da conversa do grupo. Por regras, sem IA.'
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={ListTodo}
          title="Mostrar a pendência da conversa"
          text={
            <>
              <b>Pendente empresa</b>: pergunta ou pedido do cliente sem resposta; promessa da equipe sem entrega (os mesmos gatilhos de
              compromisso das Demandas, ex.: <i>vou verificar e te retorno</i>); documento do cliente a conferir.{' '}
              <b>Pendente cliente</b>: a equipe pediu algo ao cliente (frases abaixo ou pergunta da equipe). Prazos citados
              (<i>até sexta</i>, <i>em 2 dias</i>) viram o prazo da pendência.
            </>
          }
          checked={enabled}
          onChange={setEnabled}
          disabled={lock}
        />
        {enabled && (
          <div className="space-y-3 py-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Pedidos da equipe ao cliente</p>
                <button type="button" disabled={lock} onClick={() => setRequests(DEFAULT_REQUEST_PHRASES.join(', '))} className="inline-flex items-center gap-1 text-[9px] text-ink-2 hover:text-ink">
                  <RotateCcw className="h-3 w-3" /> Lista padrão
                </button>
              </div>
              <p className="mb-1 text-xs text-ink-2">Mensagem da equipe com uma destas frases deixa a pendência com o cliente. Separe por vírgula.</p>
              <Textarea rows={3} value={requests} onChange={(e) => setRequests(e.target.value)} disabled={lock} aria-label="Pedidos da equipe ao cliente" />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Entregas</p>
                <button type="button" disabled={lock} onClick={() => setDeliveries(DEFAULT_DELIVERY_PHRASES.join(', '))} className="inline-flex items-center gap-1 text-[9px] text-ink-2 hover:text-ink">
                  <RotateCcw className="h-3 w-3" /> Lista padrão
                </button>
              </div>
              <p className="mb-1 text-xs text-ink-2">
                Cumprem a promessa da equipe (ou o pedido feito ao cliente). Arquivo enviado (imagem, vídeo, documento) também conta como entrega.
              </p>
              <Textarea rows={3} value={deliveries} onChange={(e) => setDeliveries(e.target.value)} disabled={lock} aria-label="Entregas" />
            </div>
          </div>
        )}
        <div className="flex justify-end pt-3">
          <Button
            type="button"
            disabled={lock}
            onClick={() =>
              start(async () => {
                const res = await saveFollowupSettings({ enabled, requestPhrases: split(requests), deliveryPhrases: split(deliveries) });
                if (!res.ok) return void toast.error(res.error);
                toast.success('Salvo. A pendência dos grupos é recalculada nos próximos minutos.');
              })
            }
          >
            <Save className="h-4 w-4" /> Salvar
          </Button>
        </div>
      </div>
    </Card>
  );
}
