'use client';

import { MessageSquareText, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Textarea, Toggle } from '@/components/ui';
import { saveDemandNotice } from '../demands/actions';

export const DEFAULT_DEMAND_NOTICE =
  '📋 *Demanda registrada* (nº {numero})\n{demanda}\n\n📅 *Previsão de entrega:* {prazo}\n👤 *Responsável:* {responsavel}';

const SAMPLE = {
  numero: '128',
  demanda: 'Enviar a segunda via do boleto de outubro',
  tipo: 'Financeiro',
  responsavel: 'Ana Souza',
  prazo: '28/10/2026 às 18:00',
  grupo: 'Cliente Exemplo',
};

/**
 * Aviso ao cliente ao registrar uma demanda (0091): o sistema manda no grupo a demanda e a data de
 * entrega, respondendo a mensagem que a originou. Texto com variáveis e prévia.
 */
export function DemandNotice({ enabled, template, disabled }: { enabled: boolean; template: string | null; disabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(template || DEFAULT_DEMAND_NOTICE);
  const [pending, start] = useTransition();
  const preview = Object.entries(SAMPLE).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), text);
  return (
    <Card>
      <CardHeader
        title="Aviso ao cliente"
        description="Ao registrar uma demanda (pelo painel, comando, palavra-chave, compromisso ou IA), o sistema manda no grupo a demanda e a data de entrega, pelo número conectado."
        action={<Toggle checked={on} onChange={setOn} disabled={disabled || pending} />}
      />
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            disabled={disabled || !on}
            aria-label="Texto do aviso"
            className="font-mono text-xs"
          />
          <p className="mt-1.5 text-[11px] text-muted">
            Variáveis: <code>{'{numero}'}</code> <code>{'{demanda}'}</code> <code>{'{tipo}'}</code> <code>{'{responsavel}'}</code>{' '}
            <code>{'{prazo}'}</code> (data de entrega, ou “a definir”) <code>{'{grupo}'}</code>. *texto* fica em negrito no WhatsApp.
          </p>
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <MessageSquareText className="h-3.5 w-3.5" /> Prévia
          </p>
          <div className="chat-wallpaper rounded-xl p-3">
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-soft px-3 py-2 text-sm text-ink shadow-sm">
              {preview.split(/(\*[^*\n]+\*)/g).map((part, i) =>
                /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>,
              )}
            </div>
          </div>
        </div>
        {!disabled && (
          <div className="flex gap-2 md:col-span-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveDemandNotice({ enabled: on, template: text === DEFAULT_DEMAND_NOTICE ? '' : text });
                  if (res.ok) toast.success(on ? 'Aviso ao cliente salvo' : 'Aviso ao cliente desligado');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
            {text !== DEFAULT_DEMAND_NOTICE && (
              <Button size="sm" variant="ghost" disabled={pending || !on} onClick={() => setText(DEFAULT_DEMAND_NOTICE)}>
                Voltar ao texto padrão
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
