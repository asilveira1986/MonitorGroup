'use client';

import { Bot, CheckCircle2, Handshake, Hash, MousePointerClick, Save, Tags, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Input, Textarea, Toggle } from '@/components/ui';
import { DEFAULT_COMMITMENT_VERBS, findCommitment } from '@/lib/commitment';
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

const split = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Gatilhos do compromisso da equipe: verbos de ação (valem em qualquer forma: vou, irei, estou ...ndo,
 * futuro, "já" + presente) e frases prontas, com um campo para testar uma frase antes de salvar.
 */
function CommitmentTriggers({
  verbs,
  onVerbs,
  phrases,
  onPhrases,
  disabled,
}: {
  verbs: string;
  onVerbs: (v: string) => void;
  phrases: string;
  onPhrases: (v: string) => void;
  disabled: boolean;
}) {
  const [sample, setSample] = useState('Irei verificar e te retorno até amanhã');
  const match = sample.trim() ? findCommitment(sample, split(verbs), split(phrases)) : null;
  return (
    <div className="mb-3 space-y-3 pl-8">
      <div>
        <p className="mb-1 text-xs font-medium">Verbos de ação</p>
        <Textarea
          rows={3}
          value={verbs}
          onChange={(e) => onVerbs(e.target.value)}
          disabled={disabled}
          placeholder="verificar, corrigir, realizar, ajustar, enviar"
          aria-label="Verbos de ação do compromisso"
        />
        <p className="mt-1 text-[11px] text-muted">
          No infinitivo. Cada verbo vale em qualquer forma de compromisso: <i>vou/vamos/irei/iremos corrigir</i>,{' '}
          <i>vou já te enviar</i>, <i>estou corrigindo</i>, <i>corrigirei</i>, <i>fico de corrigir</i>, <i>já corrijo</i>. Com
          negação antes (<i>não vou conseguir verificar</i>) não abre demanda.
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium">Frases prontas</p>
        <Textarea
          rows={2}
          value={phrases}
          onChange={(e) => onPhrases(e.target.value)}
          disabled={disabled}
          placeholder="te retorno, dar uma olhada, deixa comigo, prazo"
          aria-label="Frases de compromisso da equipe"
        />
        <p className="mt-1 text-[11px] text-muted">Basta a frase aparecer na mensagem.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-2/50 p-3">
        <p className="mb-1.5 text-xs font-medium">Testar uma resposta da equipe</p>
        <Input value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Frase para testar" placeholder="Ex.: vou corrigir e te aviso" />
        {sample.trim() && (
          <p className={`mt-2 flex items-center gap-1.5 text-xs ${match ? 'text-good-ink' : 'text-muted'}`} role="status">
            {match ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {match ? (
              <span>
                Abre demanda · gatilho <b>&quot;{match.trigger}&quot;</b> ({match.kind === 'verb' ? 'verbo de ação' : 'frase pronta'})
              </span>
            ) : (
              'Não abre demanda por compromisso (um prazo como "até amanhã" ainda abre).'
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function DemandSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [manual, setManual] = useState(settings.demand_manual_enabled);
  const [command, setCommand] = useState(settings.demand_command_enabled);
  const [keyword, setKeyword] = useState(settings.demand_keyword_enabled);
  const [keywords, setKeywords] = useState((settings.demand_keywords ?? []).join(', '));
  const [ai, setAi] = useState(settings.demand_ai_enabled);
  const [commitment, setCommitment] = useState(settings.demand_commitment_enabled ?? true);
  const [commitmentKeywords, setCommitmentKeywords] = useState((settings.demand_commitment_keywords ?? []).join(', '));
  const [commitmentVerbs, setCommitmentVerbs] = useState((settings.demand_commitment_verbs ?? DEFAULT_COMMITMENT_VERBS).join(', '));
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
        <div>
          <Row
            icon={Handshake}
            title="Compromisso da equipe"
            text={
              <>
                Abre a demanda quando alguém da equipe assume uma tarefa na conversa (ex.: <i>irei verificar e te retorno</i>,{' '}
                <i>vou corrigir</i>, <i>já estou ajustando</i>, <i>verificarei</i>) ou informa um prazo (<i>até amanhã</i>, <i>até sexta</i>, <i>em 2 dias</i>). A
                descrição é o pedido do cliente que foi respondido, o responsável é quem respondeu e o prazo, se houver, já
                entra na demanda. Se o pedido já for uma demanda, ela só passa para &quot;em andamento&quot; e recebe o prazo.
              </>
            }
            checked={commitment}
            onChange={setCommitment}
            disabled={disabled || pending}
          />
          {commitment && (
            <CommitmentTriggers
              verbs={commitmentVerbs}
              onVerbs={setCommitmentVerbs}
              phrases={commitmentKeywords}
              onPhrases={setCommitmentKeywords}
              disabled={disabled || pending}
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
                    commitment,
                    commitmentKeywords: commitmentKeywords.split(/[,;\n]+/),
                    commitmentVerbs: commitmentVerbs.split(/[,;\n]+/),
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
