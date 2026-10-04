'use client';

import { MessageSquareReply, PenLine, Save, ShieldCheck } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Select } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { saveReplySettings } from './actions';
import { Row } from './demand-settings';

export function ReplySettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [enabled, setEnabled] = useState(settings.reply_enabled);
  const [signName, setSignName] = useState(settings.reply_sign_name);
  const [allowed, setAllowed] = useState<'all' | 'admin'>(settings.reply_allowed);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Responder pelo sistema"
        description="Permite responder os grupos pela tela de conversa. A mensagem sai pelo número conectado e aparece também no celular."
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={MessageSquareReply}
          title="Responder grupos pelo painel"
          text="Mostra a caixa de resposta na conversa de cada grupo monitorado. Mensagens enviadas pelo celular continuam aparecendo aqui normalmente."
          checked={enabled}
          onChange={setEnabled}
          disabled={disabled || pending}
        />
        {enabled && (
          <>
            <Row
              icon={PenLine}
              title="Assinar com o nome de quem respondeu"
              text={
                <>
                  Como todos respondem pelo mesmo número, a mensagem começa com o nome em negrito, ex.:{' '}
                  <code>*Ana Souza:*</code>.
                </>
              }
              checked={signName}
              onChange={setSignName}
              disabled={disabled || pending}
            />
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
                <div>
                  <p className="text-sm font-medium">Quem pode responder</p>
                  <p className="mt-0.5 text-xs text-ink-2">A permissão também é conferida no banco de dados.</p>
                </div>
              </div>
              <Select
                value={allowed}
                onChange={(e) => setAllowed(e.target.value as 'all' | 'admin')}
                disabled={disabled || pending}
                className="sm:w-56"
                aria-label="Quem pode responder"
              >
                <option value="all">Todos os usuários</option>
                <option value="admin">Só administradores</option>
              </Select>
            </div>
          </>
        )}
        {!disabled && (
          <div className="pt-4">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveReplySettings({ enabled, signName, allowed });
                  if (res.ok) toast.success('Configuração de respostas salva');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
