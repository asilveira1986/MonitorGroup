'use client';

import { Loader2, Mic, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/format';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const SPEEDS = [1, 1.5, 2];

/**
 * Tocador de áudio como no WhatsApp: ▶, barra de progresso e o tempo. A duração vem guardada com a
 * mensagem (0088) e aparece antes de tocar; sem ela, o tocador lê o tempo do começo do arquivo.
 * Velocidade 1×/1,5×/2×.
 */
export function AudioPlayer({
  src,
  seconds,
  onPlay,
  onError,
  voice = true,
}: {
  src: string;
  /** duração guardada (null: aparece quando o arquivo carregar) */
  seconds?: number | null;
  onPlay?: () => void;
  onError?: () => void;
  voice?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number>(seconds ?? 0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) return a.pause();
    setLoading(a.readyState < 2);
    void a.play().catch(() => setLoading(false));
  };
  const total = duration || seconds || 0;
  const pct = total ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="mb-1 flex w-72 max-w-full items-center gap-2" aria-label="Áudio">
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink hover:opacity-90"
        aria-label={playing ? 'Pausar' : 'Ouvir'}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.1}
          value={current}
          onChange={(e) => {
            const t = Number(e.target.value);
            setCurrent(t);
            if (ref.current) ref.current.currentTime = t;
          }}
          aria-label="Posição do áudio"
          className="h-1 w-full cursor-pointer accent-[var(--brand)]"
          style={{ background: `linear-gradient(to right, var(--brand) ${pct}%, var(--line) ${pct}%)` }}
        />
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
          <span className="tabular inline-flex items-center gap-1">
            {voice && <Mic className="h-3 w-3" aria-hidden />}
            {playing || current > 0 ? `${clock(current)} / ${total ? clock(total) : '—'}` : total ? clock(total) : '—'}
          </span>
          <button
            type="button"
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
            className={cn('tabular rounded px-1 font-semibold hover:text-ink', speed !== 1 && 'text-brand-text')}
            title="Velocidade"
          >
            {String(speed).replace('.', ',')}×
          </button>
        </div>
      </div>
      <audio
        ref={ref}
        src={src}
        // sem a duração guardada (áudios antigos ou sem a informação do WhatsApp): carrega só o
        // começo do arquivo para saber o tempo; com ela, o arquivo só baixa ao dar play
        preload={seconds ? 'none' : 'metadata'}
        onPlay={() => {
          setPlaying(true);
          onPlay?.();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onPlaying={() => setLoading(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          if (Number.isFinite(a.duration) && a.duration > 0) return setDuration(a.duration);
          // alguns arquivos (gravados no navegador) não trazem a duração no começo: pula para o fim
          // para o navegador calcular, e volta
          if (a.duration === Infinity) {
            const back = () => {
              a.removeEventListener('durationchange', back);
              if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
              a.currentTime = 0;
            };
            a.addEventListener('durationchange', back);
            a.currentTime = 1e7;
          }
        }}
        onError={() => {
          setLoading(false);
          onError?.();
        }}
        className="hidden"
      />
    </div>
  );
}
