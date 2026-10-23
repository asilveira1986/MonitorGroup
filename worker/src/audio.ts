import { spawn } from 'node:child_process';
import { logger } from './logger.js';

/**
 * Áudio gravado no painel (webm/ogg/mp4, conforme o navegador) → mensagem de voz do WhatsApp
 * (OGG/Opus mono), que toca no Android e no iPhone. Sem o ffmpeg instalado, devolve null
 * e o áudio vai como veio.
 */
export function toVoiceNote(input: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (out: Buffer | null) => {
      if (done) return;
      done = true;
      resolve(out);
    };
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const chunks: Buffer[] = [];
    let err = '';
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.stderr.on('data', (c: Buffer) => (err += c.toString()));
    ff.on('error', (e) => {
      logger.warn({ err: e.message }, 'ffmpeg indisponível: áudio enviado sem converter');
      finish(null);
    });
    ff.on('close', (code) => {
      if (code === 0 && chunks.length) return finish(Buffer.concat(chunks));
      logger.warn({ code, err: err.slice(0, 500) }, 'não foi possível converter o áudio');
      finish(null);
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(input);
  });
}

/** Conteúdo de áudio para o sendMessage: voz (ptt, convertida) ou arquivo de áudio comum. */
export async function audioContent(buffer: Buffer, mimetype: string, voice: boolean) {
  if (!voice) return { audio: buffer, mimetype };
  const ogg = await toVoiceNote(buffer);
  return ogg ? { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true } : { audio: buffer, mimetype, ptt: true };
}
