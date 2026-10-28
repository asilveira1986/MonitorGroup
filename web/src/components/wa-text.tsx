import { Fragment, type ReactNode } from 'react';

// *negrito*, _itálico_ e ~riscado~ como no WhatsApp: o marcador colado no texto (sem espaço por
// dentro), no começo da linha ou depois de espaço/pontuação, e sem atravessar linhas
const WA_STYLE = /(^|[\s([{"'“])([*_~])(?!\s)([^\n]*?[^\s])\2(?=$|[\s.,!?:;)\]}"'”])/g;

/** Texto de mensagem com a formatação do WhatsApp (negrito, itálico, riscado). */
export function waFormat(text: string | null | undefined): ReactNode {
  if (!text || !/[*_~]/.test(text)) return text ?? '';
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(WA_STYLE)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    const inner = m[3];
    out.push(
      m[2] === '*' ? (
        <strong key={k++} className="font-semibold">
          {inner}
        </strong>
      ) : m[2] === '_' ? (
        <em key={k++}>{inner}</em>
      ) : (
        <s key={k++}>{inner}</s>
      ),
    );
    last = (m.index ?? 0) + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
