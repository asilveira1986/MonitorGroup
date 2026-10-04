'use client';

import { Bot, Hash, MousePointerClick, Save, Tags } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Textarea, Toggle } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { saveDemandSettings } from '../demands/actions';

export function Row({
  icon: Icon,
  title,
  text,
  checked,
  onChange,
  disabled,
}: {
  icon: typeof Hash;
  title: string;
  text: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <div className="mt-0.5 text-xs text-ink-2">{text}</div>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function DemandSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [manual, setManual] = useState(settings.demand_manual_enabled);
  const [command, setCommand] = useState(settings.demand_command_enabled);
  const [keyword, setKeyword] = useState(settings.demand_keyword_enabled);
  const [keywords, setKeywords] = useState((settings.demand_keywords ?? []).join(', '));
  const [ai, setAi] = useState(settings.demand_ai_enabled);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader title="Demandas" description="Como uma demanda pode nascer. Cada forma pode ser ligada ou desligada." />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={MousePointerClick}
          title="Marcação manual"
          text='Botão "criar demanda" nas mensagens da conversa e "Nova demanda" na tela de Demandas.'
          checked={manual}
          onChange={setManual}
          disabled={disabled || pending}
        />
        <Row
          icon={Hash}
          title="Comandos no WhatsApp"
          text={
            <>
              A equipe responde a mensagem do cliente com <code>#demanda</code> (opcionalmente com descrição e prazo, ex.:{' '}
              <code>#demanda Orçamento até sexta</code>). Também: <code>#andamento</code>, <code>#entregue</code>,{' '}
              <code>#cancelada</code>, <code>#prazo 15/10</code> e <code>#confirmada</code>.
            </>
          }
          checked={command}
          onChange={setCommand}
          disabled={disabled || pending}
        />
        <div>
          <Row
            icon={Tags}
            title="Palavras-chave do cliente"
            text="Abre uma demanda quando a mensagem do cliente contém uma destas palavras."
            checked={keyword}
            onChange={setKeyword}
            disabled={disabled || pending}
          />
          {keyword && (
            <Textarea
              rows={2}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              disabled={disabled || pending}
              className="mb-3"
              placeholder="solicito, preciso de, orçamento"
            />
          )}
        </div>
        <Row
          icon={Bot}
          title="Classificação automática por IA"
          text={
            <>
              Usa o Claude para reconhecer pedidos nas mensagens dos clientes e já classificar o tipo. Exige a variável{' '}
              <code>ANTHROPIC_API_KEY</code> no worker (Railway) e tem custo por mensagem analisada.
            </>
          }
          checked={ai}
          onChange={setAi}
          disabled={disabled || pending}
        />
        {!disabled && (
          <div className="pt-4">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveDemandSettings({
                    manual,
                    command,
                    keyword,
                    keywords: keywords.split(/[,;\n]+/),
                    ai,
                  });
                  if (res.ok) toast.success('Configurações de demandas salvas');
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
