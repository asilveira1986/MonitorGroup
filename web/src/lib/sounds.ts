/**
 * Sons dos avisos em tela, gerados no próprio navegador (Web Audio, sem arquivos).
 * Cada tipo tem um som próprio, para reconhecer o aviso sem olhar a tela:
 *  - mensagem recebida: duas notas suaves subindo (plim-plim);
 *  - informativo: uma nota curta e leve;
 *  - atenção: dois bipes médios;
 *  - crítico: alarme curto e insistente (três bipes agudos, duas vezes).
 * Com o aviso por voz falando, toca só o bipe curto antes da fala.
 * O navegador só libera o som depois do primeiro clique na página.
 */
export type AlertSound = 'message' | 'info' | 'warning' | 'critical' | 'voice';

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const PATTERNS: Record<AlertSound, Note[]> = {
  // plim-plim: duas notas subindo, timbre suave
  message: [
    { freq: 659, at: 0, dur: 0.16, type: 'sine', gain: 0.22 },
    { freq: 988, at: 0.15, dur: 0.28, type: 'sine', gain: 0.22 },
  ],
  // uma nota leve
  info: [{ freq: 1047, at: 0, dur: 0.22, type: 'sine', gain: 0.16 }],
  // dois bipes médios
  warning: [
    { freq: 740, at: 0, dur: 0.18, type: 'triangle', gain: 0.3 },
    { freq: 740, at: 0.28, dur: 0.18, type: 'triangle', gain: 0.3 },
  ],
  // alarme: três bipes agudos alternados, duas vezes
  critical: [0, 1, 2, 3, 4, 5].map((i) => ({
    freq: i % 2 ? 1319 : 988,
    at: i * 0.13 + (i >= 3 ? 0.2 : 0),
    dur: 0.1,
    type: 'square' as OscillatorType,
    gain: 0.14,
  })),
  // bipe curto antes da fala
  voice: [
    { freq: 880, at: 0, dur: 0.16, type: 'sine', gain: 0.25 },
    { freq: 1175, at: 0.18, dur: 0.16, type: 'sine', gain: 0.25 },
  ],
};

export const SOUND_LABEL: Record<Exclude<AlertSound, 'voice'>, string> = {
  message: 'Mensagem recebida',
  info: 'Informativo',
  warning: 'Atenção',
  critical: 'Crítico',
};

export function playAlertSound(kind: AlertSound) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    let end = 0;
    for (const n of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.freq;
      const t = ctx.currentTime + n.at;
      const peak = n.gain ?? 0.25;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.dur + 0.02);
      end = Math.max(end, n.at + n.dur);
    }
    setTimeout(() => void ctx.close(), (end + 0.5) * 1000);
  } catch {
    /* sem áudio */
  }
}
