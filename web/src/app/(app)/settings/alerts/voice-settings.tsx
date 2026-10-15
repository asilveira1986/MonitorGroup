'use client';

import { BellRing, Clock, MessageSquareText, PlayCircle, Save, Speech } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TEST_EVENT } from '@/components/message-notifier';
import { Button, Card, CardHeader } from '@/components/ui';
import { saveVoiceSettings } from '../actions';
import { Row } from '../demand-settings';

/**
 * Aviso por voz: o navegador fala o aviso em português junto com o alerta em tela.
 * Liga/desliga geral e por tipo; cada regra de alerta também escolhe se é falada.
 */
export function VoiceSettings({
  initial,
  disabled,
  rulesWithVoice,
  rulesTotal,
}: {
  initial: { voice: boolean; messages: boolean; sla: boolean };
  disabled: boolean;
  rulesWithVoice: number;
  rulesTotal: number;
}) {
  const [voice, setVoice] = useState(initial.voice);
  const [messages, setMessages] = useState(initial.messages);
  const [sla, setSla] = useState(initial.sla);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Aviso por voz"
        description="Junto com o aviso em tela, o navegador fala em português, logo depois do bipe. Não lê o texto da mensagem, só o grupo e quem enviou. Cada usuário ainda pode silenciar no próprio navegador pelo sino do topo."
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={Speech}
          title="Aviso por voz"
          text="Liga ou desliga a voz para todos os usuários da empresa."
          checked={voice}
          onChange={setVoice}
          disabled={disabled || pending}
        />
        {voice && (
          <>
            <Row
              icon={MessageSquareText}
              title="Falar as mensagens novas"
              text={<>“Nova mensagem no grupo Vendas SP, de Carla.”</>}
              checked={messages}
              onChange={setMessages}
              disabled={disabled || pending}
            />
            <Row
              icon={Clock}
              title="Falar o SLA excedido"
              text={<>“Atenção: SLA excedido no grupo Vendas SP, sem resposta há 18 minutos.”</>}
              checked={sla}
              onChange={setSla}
              disabled={disabled || pending}
            />
            <div className="flex gap-3 py-3">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
              <div>
                <p className="text-sm font-medium">Alertas das regras</p>
                <p className="mt-0.5 text-xs text-ink-2">
                  “Atenção! Alerta: palavra-chave, no grupo Vendas SP.” Cada regra escolhe se é falada (em Editar regra ›
                  Aviso por voz). Hoje: {rulesWithVoice} de {rulesTotal} regra(s) com voz.
                </p>
              </div>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-4">
          {!disabled && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveVoiceSettings({ voice, messages, sla });
                  if (res.ok) toast.success('Aviso por voz salvo');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.dispatchEvent(new Event(TEST_EVENT))}
            title="Mostra e fala um aviso de exemplo com a configuração salva"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Testar a voz
          </Button>
        </div>
      </div>
    </Card>
  );
}
