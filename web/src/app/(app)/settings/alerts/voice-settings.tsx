'use client';

import { BellRing, Clock, MessageSquareText, Play, RotateCcw, Save, Speech, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Select, Textarea, Toggle } from '@/components/ui';
import { cn } from '@/lib/format';
import {
  DEFAULT_TEMPLATES,
  listVoices,
  renderTemplate,
  sampleValues,
  speak,
  VOICE_VARIABLES,
  type VoiceEvent,
  type VoiceOptions,
} from '@/lib/voice';
import { saveVoiceSettings } from '../actions';

export type VoiceSettingsValue = {
  voice: boolean;
  messages: boolean;
  sla: boolean;
  templates: Partial<Record<VoiceEvent, string>>;
  voiceName: string | null;
  rate: number;
  pitch: number;
};

/** Vozes do navegador (carregam depois da página). */
function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(listVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);
  return voices;
}

/** Frase de um aviso: texto livre + itens clicáveis que entram onde está o cursor. */
function TemplateEditor({
  event,
  icon: Icon,
  title,
  hint,
  enabled,
  onEnabled,
  value,
  onChange,
  options,
  disabled,
}: {
  event: VoiceEvent;
  icon: LucideIcon;
  title: string;
  hint?: string;
  /** ausente: o aviso não tem liga/desliga aqui (ex.: alertas, por regra) */
  enabled?: boolean;
  onEnabled?: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  options: VoiceOptions;
  disabled: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value || DEFAULT_TEMPLATES[event];
  const preview = renderTemplate(text, sampleValues(event));
  const off = enabled === false;

  const insert = (key: string) => {
    const el = ref.current;
    const token = `{${key}}`;
    if (!el) return onChange(`${text} ${token}`);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
          <div>
            <p className="text-sm font-medium">{title}</p>
            {hint && <p className="mt-0.5 text-xs text-ink-2">{hint}</p>}
          </div>
        </div>
        {onEnabled && <Toggle checked={!off} onChange={onEnabled} disabled={disabled} />}
      </div>
      {!off && (
        <div className="mt-3 space-y-2 pl-8">
          <Textarea
            ref={ref}
            rows={2}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={`Frase falada: ${title}`}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted">Inserir:</span>
            {VOICE_VARIABLES[event].map((v) => (
              <button
                key={v.key}
                type="button"
                disabled={disabled}
                onClick={() => insert(v.key)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
                  text.includes(`{${v.key}}`)
                    ? 'border-brand-line bg-brand-soft text-brand-text'
                    : 'border-line text-ink-2 hover:border-brand-line hover:text-ink',
                )}
                title={`Insere {${v.key}} na frase`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2/60 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-ink-2">
              <span className="text-muted">Exemplo: </span>“{preview}”
            </p>
            <Button type="button" size="sm" variant="secondary" onClick={() => speak(preview, options)}>
              <Play className="h-3.5 w-3.5" /> Ouvir
            </Button>
            {value && value !== DEFAULT_TEMPLATES[event] && (
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange('')} title="Volta para a frase padrão">
                <RotateCcw className="h-3.5 w-3.5" /> Padrão
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Aviso por voz: liga/desliga, o que cada aviso fala (frase com itens), a voz, a velocidade e o tom.
 * Os alertas das regras são falados conforme cada regra (Editar regra › Aviso por voz).
 */
export function VoiceSettings({
  initial,
  disabled,
  rulesWithVoice,
  rulesTotal,
}: {
  initial: VoiceSettingsValue;
  disabled: boolean;
  rulesWithVoice: number;
  rulesTotal: number;
}) {
  const [v, setV] = useState<VoiceSettingsValue>(initial);
  const [pending, start] = useTransition();
  const voices = useVoices();
  const options: VoiceOptions = { voiceName: v.voiceName, rate: v.rate, pitch: v.pitch, templates: v.templates };
  const set = (patch: Partial<VoiceSettingsValue>) => setV((prev) => ({ ...prev, ...patch }));
  const setTemplate = (event: VoiceEvent, text: string) => set({ templates: { ...v.templates, [event]: text } });
  const lock = disabled || pending;
  const selectedMissing = v.voiceName && voices.length > 0 && !voices.some((x) => x.name === v.voiceName);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Aviso por voz"
          description="Junto com o aviso em tela, o navegador fala logo depois do bipe. Escolha o que cada aviso fala, a voz, a velocidade e o tom. Cada usuário ainda pode silenciar no próprio navegador pelo sino do topo."
        />
        <div className="divide-y divide-line px-4 pb-4 sm:px-5">
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="flex gap-3">
              <Speech className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
              <div>
                <p className="text-sm font-medium">Aviso por voz</p>
                <p className="mt-0.5 text-xs text-ink-2">Liga ou desliga a voz para todos os usuários da empresa.</p>
              </div>
            </div>
            <Toggle checked={v.voice} onChange={(x) => set({ voice: x })} disabled={lock} />
          </div>
          {v.voice && (
            <>
              <TemplateEditor
                event="message"
                icon={MessageSquareText}
                title="Mensagem nova"
                hint="Falado quando chega mensagem de cliente."
                enabled={v.messages}
                onEnabled={(x) => set({ messages: x })}
                value={v.templates.message ?? ''}
                onChange={(t) => setTemplate('message', t)}
                options={options}
                disabled={lock}
              />
              <TemplateEditor
                event="sla"
                icon={Clock}
                title="SLA excedido"
                hint="Falado quando a mensagem do cliente passa do tempo de resposta."
                enabled={v.sla}
                onEnabled={(x) => set({ sla: x })}
                value={v.templates.sla ?? ''}
                onChange={(t) => setTemplate('sla', t)}
                options={options}
                disabled={lock}
              />
              <TemplateEditor
                event="alert"
                icon={BellRing}
                title="Alertas das regras"
                hint={`Cada regra escolhe se é falada (Editar regra › Aviso por voz). Hoje: ${rulesWithVoice} de ${rulesTotal} regra(s) com voz.`}
                value={v.templates.alert ?? ''}
                onChange={(t) => setTemplate('alert', t)}
                options={options}
                disabled={lock}
              />
            </>
          )}
        </div>
      </Card>

      {v.voice && (
        <Card>
          <CardHeader
            title="Voz"
            description="As vozes disponíveis são as instaladas no computador e no navegador. Se a voz escolhida não existir em outro computador, ele usa a voz em português padrão dele."
          />
          <div className="grid gap-4 px-4 pb-5 sm:grid-cols-3 sm:px-5">
            <label className="block text-sm sm:col-span-3">
              <span className="mb-1 block font-medium">Voz</span>
              <Select value={v.voiceName ?? ''} onChange={(e) => set({ voiceName: e.target.value || null })} disabled={lock}>
                <option value="">Padrão em português do computador</option>
                {selectedMissing && <option value={v.voiceName!}>{v.voiceName} (não existe neste computador)</option>}
                {voices.map((x) => (
                  <option key={x.voiceURI} value={x.name}>
                    {x.name} · {x.lang}
                    {x.localService ? '' : ' · online'}
                  </option>
                ))}
              </Select>
              {voices.length === 0 && (
                <span className="mt-1 block text-xs text-muted">Este navegador não informou nenhuma voz; ele usará a padrão.</span>
              )}
            </label>
            <label className="block text-sm">
              <span className="mb-1 flex justify-between font-medium">
                Velocidade <span className="tabular text-xs text-muted">{v.rate.toFixed(1)}×</span>
              </span>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.1}
                value={v.rate}
                onChange={(e) => set({ rate: Number(e.target.value) })}
                disabled={lock}
                className="w-full accent-[var(--brand-line)]"
                aria-label="Velocidade da voz"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 flex justify-between font-medium">
                Tom <span className="tabular text-xs text-muted">{v.pitch.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.1}
                value={v.pitch}
                onChange={(e) => set({ pitch: Number(e.target.value) })}
                disabled={lock}
                className="w-full accent-[var(--brand-line)]"
                aria-label="Tom da voz"
              />
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => speak(renderTemplate(v.templates.message || DEFAULT_TEMPLATES.message, sampleValues('message')), options)}
              >
                <Play className="h-3.5 w-3.5" /> Ouvir esta voz
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!disabled && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveVoiceSettings(v);
              if (res.ok) toast.success('Aviso por voz salvo');
              else toast.error(res.error);
            })
          }
        >
          <Save className="h-4 w-4" /> Salvar aviso por voz
        </Button>
      )}
    </div>
  );
}
