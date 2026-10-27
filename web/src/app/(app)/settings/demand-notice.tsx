'use client';

import { MessageSquareText, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Textarea, Toggle } from '@/components/ui';
import { saveDemandNotice } from '../demands/actions';

const KINDS = {
  created: {
    title: 'Aviso ao cliente: demanda registrada',
    description:
      'Ao registrar uma demanda (pelo painel, comando, palavra-chave, compromisso ou IA), o sistema manda no grupo a demanda e a data de entrega, pelo número conectado.',
    template: '📋 *Demanda registrada* (nº {numero})\n{demanda}\n\n📅 *Previsão de entrega:* {prazo}\n👤 *Responsável:* {responsavel}',
    vars: ['numero', 'demanda', 'tipo', 'responsavel', 'prazo', 'grupo'],
    hint: '{prazo} é a data de entrega, ou “a definir”.',
  },
  done: {
    title: 'Aviso ao cliente: demanda concluída',
    description:
      'Ao marcar “Demanda entregue” (ou #entregue no WhatsApp), o sistema avisa o cliente no grupo, com a observação escrita na entrega, se houver.',
    template:
      '✅ *Demanda concluída* (nº {numero})\n{demanda}\n\n📅 *Entregue em:* {entregue_em}\n👤 *Responsável:* {responsavel}{observacao}',
    vars: ['numero', 'demanda', 'tipo', 'responsavel', 'entregue_em', 'observacao', 'grupo'],
    hint: '{observacao} vira “📝 Observação: …” quando a entrega tiver observação (e some quando não tiver).',
  },
  // avisos no WhatsApp da equipe (0106)
  agenda_new: {
    title: 'Novo compromisso: aviso no WhatsApp de quem foi incluído',
    description:
      'Quando alguém inclui uma pessoa num compromisso, ela recebe o aviso no WhatsApp dela (o telefone do perfil ou o da equipe), pelo número conectado.',
    template: '📅 *Novo compromisso na sua agenda*\n*{titulo}*\n🗓️ {data} {hora}{observacao}\n\nMarcado por {criado_por}',
    vars: ['titulo', 'data', 'hora', 'tipo', 'observacao', 'participantes', 'criado_por', 'link'],
    hint: '{hora} é “às 14:30” ou “dia todo”; {observacao} vira “📝 …” quando houver; {link} abre o compromisso no painel.',
  },
  agenda_reminder: {
    title: 'Lembretes dos compromissos no WhatsApp',
    description:
      'Nos lembretes escolhidos em cada compromisso (15 min antes, na véspera…), cada participante recebe também o lembrete no WhatsApp dele.',
    template: '⏰ *Lembrete:* {titulo}\n🗓️ {data} {hora} ({quando}){observacao}',
    vars: ['titulo', 'data', 'hora', 'quando', 'tipo', 'observacao', 'participantes', 'criado_por', 'link'],
    hint: '{quando} é “em 15 min”, “amanhã”…',
  },
  demand_assignee: {
    title: 'Nova demanda: aviso no WhatsApp do responsável',
    description: 'Quando uma demanda é registrada (ou passada) para alguém, o responsável recebe o aviso no WhatsApp dele.',
    template: '📋 *Nova demanda para você* (nº {numero})\n{demanda}\n\n👥 *Grupo:* {grupo}\n📅 *Prazo:* {prazo}',
    vars: ['numero', 'demanda', 'tipo', 'grupo', 'prazo'],
    hint: '{prazo} é a data de entrega, ou “a definir”.',
  },
} as const;
export type NoticeKind = keyof typeof KINDS;

export const DEFAULT_DEMAND_NOTICE = KINDS.created.template;

const SAMPLE: Record<string, string> = {
  numero: '128',
  demanda: 'Enviar a segunda via do boleto de outubro',
  tipo: 'Financeiro',
  responsavel: 'Ana Souza',
  prazo: '28/10/2026 às 18:00',
  entregue_em: '27/10/2026 às 16:40',
  observacao: '\n\n📝 *Observação:* Boleto enviado para o e-mail do financeiro, vencimento dia 05.',
  grupo: 'Cliente Exemplo',
  titulo: 'Reunião com o cliente',
  data: '28/10/2026',
  hora: 'às 14:30',
  quando: 'em 15 min',
  participantes: 'Ana Souza, Bruno Lima',
  criado_por: 'Alexandre Silveira',
  link: 'https://seu-painel.vercel.app/agenda?evento=…',
};

/**
 * Aviso ao cliente ao registrar uma demanda (0091): o sistema manda no grupo a demanda e a data de
 * entrega, respondendo a mensagem que a originou. Texto com variáveis e prévia.
 */
export function DemandNotice({
  kind = 'created',
  enabled,
  template,
  disabled,
}: {
  kind?: keyof typeof KINDS;
  enabled: boolean;
  template: string | null;
  disabled: boolean;
}) {
  const k = KINDS[kind];
  const DEFAULT = k.template as string;
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(template || DEFAULT);
  const [pending, start] = useTransition();
  const preview = Object.entries(SAMPLE).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), text);
  return (
    <Card>
      <CardHeader
        title={k.title}
        description={k.description}
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
            Variáveis:{' '}
            {k.vars.map((v) => (
              <code key={v} className="mr-1">{`{${v}}`}</code>
            ))}
            . {k.hint} *texto* fica em negrito no WhatsApp.
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
                  const res = await saveDemandNotice({ kind, enabled: on, template: text === DEFAULT ? '' : text });
                  if (res.ok) toast.success(on ? 'Aviso salvo' : 'Aviso desligado');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
            {text !== DEFAULT && (
              <Button size="sm" variant="ghost" disabled={pending || !on} onClick={() => setText(DEFAULT)}>
                Voltar ao texto padrão
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
