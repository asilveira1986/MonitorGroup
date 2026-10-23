"use client";

import {
  Loader2,
  Mic,
  Pause,
  Play,
  SendHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";

const MAX_SECONDS = 15 * 60;
// o que o navegador gravar (Firefox: ogg; Chrome: webm; Safari: mp4); o worker converte para a voz do WhatsApp
const MIMES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export type VoiceClip = {
  blob: Blob;
  mime: string;
  ext: string;
  seconds: number;
};

/**
 * Gravar áudio como no WhatsApp: o microfone grava (com o tempo na tela), o ■ para e deixa ouvir
 * antes de enviar, a lixeira descarta. Enquanto grava ou revisa, ocupa a linha da caixa de mensagem
 * (onActiveChange avisa para esconder o resto).
 */
export function VoiceRecorder({
  onSend,
  onActiveChange,
  disabled,
}: {
  onSend: (clip: VoiceClip) => Promise<boolean>;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<
    "idle" | "recording" | "review" | "sending"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const startedAt = useRef(0);
  const discardOnStop = useRef(false);

  const setActive = (s: typeof state) => {
    setState(s);
    onActiveChange?.(s !== "idle");
  };
  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) recorder.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [state]);
  useEffect(
    () => () => {
      discardOnStop.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const start = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return void toast.error("Este navegador não grava áudio.");
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch {
      return void toast.error("Sem acesso ao microfone", {
        description: "Permita o uso do microfone no navegador para gravar.",
      });
    }
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(
      stream.current,
      mime ? { mimeType: mime } : undefined,
    );
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      release();
      if (discardOnStop.current) {
        discardOnStop.current = false;
        return;
      }
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
      const blob = new Blob(chunks, { type });
      const secs = (Date.now() - startedAt.current) / 1000;
      if (secs < 1 || !blob.size) {
        toast.info("Áudio muito curto: segure um pouco mais.");
        return setActive("idle");
      }
      setClip({
        blob,
        mime: type,
        ext: type.includes("ogg")
          ? "ogg"
          : type.includes("mp4")
            ? "m4a"
            : "webm",
        seconds: secs,
      });
      setUrl(URL.createObjectURL(blob));
      setActive("review");
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    rec.start(250);
    setActive("recording");
  };

  const discard = () => {
    if (state === "recording") {
      discardOnStop.current = true;
      recorder.current?.stop();
    }
    audio.current?.pause();
    setPlaying(false);
    setClip(null);
    setUrl(null);
    setActive("idle");
  };

  const send = async () => {
    if (!clip) return;
    audio.current?.pause();
    setState("sending");
    const ok = await onSend(clip);
    if (ok) {
      setClip(null);
      setUrl(null);
      setActive("idle");
    } else setState("review");
  };

  const round =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40";
  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled}
        className={cn(
          round,
          "border border-line text-ink-2 hover:border-brand-line hover:text-brand-text",
        )}
        aria-label="Gravar áudio"
        title="Gravar áudio"
      >
        <Mic className="h-5 w-5" />
      </button>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
      <button
        type="button"
        onClick={discard}
        disabled={state === "sending"}
        className={cn(
          round,
          "text-ink-2 hover:bg-surface-2 hover:text-critical-ink",
        )}
        aria-label="Descartar áudio"
        title="Descartar"
      >
        <Trash2 className="h-5 w-5" />
      </button>
      <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface px-3">
        {state === "recording" ? (
          <>
            <span
              className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-critical"
              aria-hidden
            />
            <span className="tabular text-sm font-medium">
              {clock(seconds)}
            </span>
            <span className="truncate text-xs text-muted">Gravando…</span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                playing ? audio.current?.pause() : void audio.current?.play()
              }
              className="shrink-0 rounded-full p-1 text-brand-text hover:bg-surface-2"
              aria-label={playing ? "Pausar" : "Ouvir antes de enviar"}
            >
              {playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <span className="tabular text-sm font-medium">
              {clock(clip?.seconds ?? 0)}
            </span>
            <span className="truncate text-xs text-muted">
              Ouça antes de enviar
            </span>
            {url && (
              <audio
                ref={audio}
                src={url}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
            )}
          </>
        )}
      </div>
      {state === "recording" ? (
        <button
          type="button"
          onClick={() => recorder.current?.stop()}
          className={cn(round, "bg-critical text-white hover:opacity-90")}
          aria-label="Parar a gravação"
          title="Parar"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void send()}
          disabled={state === "sending"}
          className={cn(round, "bg-brand text-brand-ink hover:opacity-90")}
          aria-label="Enviar áudio"
          title="Enviar"
        >
          {state === "sending" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <SendHorizontal className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  );
}
