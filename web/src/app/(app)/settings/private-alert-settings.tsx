'use client';

import { BellRing, Inbox, MessageCircle, Save, Smartphone, Volume2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { savePrivateAlertSettings } from './actions';
import { Row } from './demand-settings';

/** Avisos em tela das conversas privadas (0120): das minhas, das que aguardam, som e voz. */
export function PrivateAlertSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [mine, setMine] = useState(settings.private_alert_mine ?? true);
  const [queue, setQueue] = useState(settings.private_alert_queue ?? true);
  const [sound, setSound] = useState(settings.private_alert_sound ?? true);
  const [voice, setVoice] = useState(settings.private_alert_voice ?? true);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Conversas privadas"
        description="Aviso no canto da tela quando chega mensagem no privado. Cada usuário só é avisado das conversas que está atendendo e das que aguardam atendimento, nunca das conversas de outro atendente."
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={MessageCircle}
          title="Avisar das conversas que estou atendendo"
          text="Mensagem nova numa conversa em que o usuário é o responsável (Meus atend.)."
          checked={mine}
          onChange={setMine}
          disabled={disabled || pending}
        />
        <Row
          icon={Inbox}
          title="Avisar das conversas aguardando atendimento"
          text="Mensagem nova numa conversa sem responsável (Aguardando): todos que usam o privado são avisados, até alguém assumir."
          checked={queue}
          onChange={setQueue}
          disabled={disabled || pending}
        />
        {(mine || queue) && (
          <>
            <Row
              icon={BellRing}
              title="Tocar som"
              text="Bipe de mensagem recebida junto com o aviso."
              checked={sound}
              onChange={setSound}
              disabled={disabled || pending}
            />
            <Row
              icon={Volume2}
              title="Falar o aviso"
              text="Lê em voz alta quem mandou e a mensagem, com a voz e a frase de “Nova mensagem” do Aviso por voz (que precisa estar ligado)."
              checked={voice}
              onChange={setVoice}
              disabled={disabled || pending}
            />
          </>
        )}
        <div className="flex gap-3 py-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <p className="text-xs text-ink-2">
            <span className="text-sm font-medium text-ink">Notificação no celular ou computador</span>
            <br />
            Cada usuário liga a sua em <strong>Meu perfil</strong> (clique no seu nome, no rodapé do menu) ›{' '}
            <strong>Notificações</strong> › “Mensagens novas nas conversas privadas”. Ela segue a mesma regra: só das
            conversas que a pessoa atende e das que aguardam.
          </p>
        </div>
        {!disabled && (
          <div className="pt-4">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await savePrivateAlertSettings({ mine, queue, sound, voice });
                  if (res.ok) toast.success('Avisos das conversas privadas salvos');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
