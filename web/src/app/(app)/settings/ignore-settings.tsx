'use client';

import { CheckCircle2, FlaskConical, MessageSquareOff, Plus, Save, Smile, X, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Input } from '@/components/ui';
import { DEFAULT_ACK_EXAMPLES, isAcknowledgement, isStickerOrEmoji, matchIgnorePhrase } from '@/lib/acknowledgement';
import type { AppSettings } from '@/lib/types';
import { saveIgnoreSettings } from './actions';
import { Row } from './demand-settings';

const SUGGESTIONS = ['obrigado pelo retorno', 'fico no aguardo', 'agradeço a atenção', 'bom dia', 'boa tarde', 'até mais'];

/**
 * Mensagens a ignorar: agradecimentos e confirmações do cliente que não pedem resposta
 * (não abrem "aguardando resposta"), figurinha/emoji e as frases que a empresa cadastrar.
 */
export function IgnoreSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [acks, setAcks] = useState(settings.ignore_acknowledgements);
  const [stickers, setStickers] = useState(settings.ignore_stickers_emoji !== false);
  const [phrases, setPhrases] = useState<string[]>(settings.ignore_phrases ?? []);
  const [draft, setDraft] = useState('');
  const [sample, setSample] = useState('');
  const [pending, start] = useTransition();
  const lock = disabled || pending;

  const add = (text: string) => {
    const parts = text
      .split(/[\n;]+/)
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!parts.length) return;
    setPhrases((prev) => {
      const known = new Set(prev.map((p) => p.toLowerCase()));
      return [...prev, ...parts.filter((p) => !known.has(p.toLowerCase()))];
    });
    setDraft('');
  };

  // resultado do teste: com as frases e opções que estão na tela (antes de salvar)
  const test = sample.trim()
    ? isStickerOrEmoji('text', sample) && stickers
      ? { ignored: true, why: 'só emoji: não conta como última mensagem do cliente' }
      : acks && isAcknowledgement('text', sample, phrases)
        ? {
            ignored: true,
            why: matchIgnorePhrase(sample, phrases)
              ? `frase cadastrada: “${matchIgnorePhrase(sample, phrases)}”`
              : 'agradecimento da lista padrão',
          }
        : { ignored: false, why: acks ? 'pede resposta (abre "aguardando resposta")' : 'a opção de ignorar agradecimentos está desligada' }
    : null;

  return (
    <Card>
      <CardHeader
        title="Mensagens a ignorar"
        description='Mensagens do cliente que não pedem resposta: depois da resposta da equipe, não deixam o grupo "aguardando resposta" nem contam no tempo de resposta. Continuam aparecendo na conversa.'
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={MessageSquareOff}
          title="Ignorar agradecimentos e confirmações"
          text={
            <>
              Lista padrão, que vale sempre:{' '}
              {DEFAULT_ACK_EXAMPLES.map((e) => (
                <span key={e} className="mr-1 inline-block rounded-full bg-surface-2 px-1.5 py-px text-[11px] text-ink-2">
                  {e}
                </span>
              ))}
              e combinações curtas dessas palavras. Somam-se as frases abaixo.
            </>
          }
          checked={acks}
          onChange={setAcks}
          disabled={lock}
        />

        {acks && (
          <div className="py-3">
            <p className="text-sm font-medium">Frases a ignorar</p>
            <p className="mt-0.5 text-xs text-ink-2">
              Ao salvar, valem para as mensagens novas e também para as já recebidas (os grupos são recalculados). Sem
              diferenciar acentos, maiúsculas e pontuação. A frase vale sozinha ou com agradecimento/emoji junto
              (&quot;Obrigado pelo retorno, doutora 🙏&quot;); se vier com pergunta ou pedido, a mensagem não é ignorada.
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(draft);
                  }
                }}
                placeholder="Ex.: obrigado pelo retorno, doutora"
                aria-label="Nova frase a ignorar"
                disabled={lock}
                maxLength={120}
              />
              <Button type="button" variant="secondary" onClick={() => add(draft)} disabled={lock || !draft.trim()}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
            {phrases.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Frases cadastradas">
                {phrases.map((p) => (
                  <li
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-text"
                  >
                    {p}
                    {!lock && (
                      <button
                        type="button"
                        onClick={() => setPhrases((prev) => prev.filter((x) => x !== p))}
                        className="rounded-full p-0.5 hover:bg-brand/20"
                        aria-label={`Remover “${p}”`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted">Nenhuma frase cadastrada.</p>
            )}
            {!lock && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted">Sugestões:</span>
                {SUGGESTIONS.filter((s) => !phrases.some((p) => p.toLowerCase() === s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => add(s)}
                    className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-2 hover:border-brand-line hover:text-brand-text"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Row
          icon={Smile}
          title="Desconsiderar figurinha e emoji como última mensagem do cliente"
          text="Continua na conversa, mas não abre pendência, não conta no tempo de resposta, não vira a última mensagem do grupo no painel e não gera aviso."
          checked={stickers}
          onChange={setStickers}
          disabled={lock}
        />

        <div className="py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="h-4 w-4 text-muted" /> Testar uma mensagem
          </p>
          <Input
            className="mt-2"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="Digite como o cliente escreveria"
            aria-label="Mensagem para testar"
          />
          {test && (
            <p
              className={
                test.ignored
                  ? 'mt-2 flex items-center gap-1.5 text-xs font-medium text-good-ink'
                  : 'mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-ink'
              }
              role="status"
            >
              {test.ignored ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {test.ignored ? 'Ignorada' : 'Não ignorada'} — {test.why}
            </p>
          )}
        </div>
      </div>
      {!disabled && (
        <div className="px-4 pb-5 sm:px-5">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveIgnoreSettings({ acknowledgements: acks, stickers, phrases });
                if (!res.ok) return void toast.error(res.error);
                const s = res.summary;
                const g = s?.grupos;
                toast.success('Mensagens a ignorar salvas', {
                  description: !s
                    ? 'Valem para as mensagens novas e já recebidas.'
                    : s.alteradas === 0
                      ? `Mensagens já recebidas conferidas (${s.revisadas.toLocaleString('pt-BR')}): nenhuma mudou.`
                      : `${s.alteradas.toLocaleString('pt-BR')} mensagem(ns) já recebida(s) atualizada(s)${
                          g ? ` · aguardando resposta: ${g.aguardando_antes} → ${g.aguardando_depois}` : ''
                        }.`,
                  duration: 10_000,
                });
              })
            }
          >
            <Save className="h-4 w-4" /> Salvar mensagens a ignorar
          </Button>
        </div>
      )}
    </Card>
  );
}
