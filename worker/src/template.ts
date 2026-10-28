import type { proto } from 'baileys';

/**
 * Mensagens de template e interativas (WhatsApp Business: avisos, botões, listas, carrossel) e as
 * respostas a elas. O WhatsApp manda o texto em partes (título, corpo, rodapé, botões); aqui vira um
 * texto só para mostrar na conversa:
 *
 *   *Título*
 *   Corpo do aviso
 *   _Rodapé_
 *   🔘 Botão de resposta
 *   🔗 Abrir site: https://…
 *   📞 Ligar: +55…
 */
export const TEMPLATE_TYPES = new Set<string>([
  'templateMessage',
  'interactiveMessage',
  'buttonsMessage',
  'listMessage',
  'templateButtonReplyMessage',
  'buttonsResponseMessage',
  'listResponseMessage',
  'interactiveResponseMessage',
]);

const clean = (s: string | null | undefined) => (s ?? '').trim();
const join = (parts: (string | null | undefined)[]) => parts.map(clean).filter(Boolean).join('\n');
const bold = (s: string | null | undefined) => (clean(s) ? `*${clean(s)}*` : '');
const italic = (s: string | null | undefined) => (clean(s) ? `_${clean(s)}_` : '');

function hydratedButtons(buttons: proto.IHydratedTemplateButton[] | null | undefined): string[] {
  return (buttons ?? [])
    .map((b) => {
      if (b.quickReplyButton?.displayText) return `🔘 ${clean(b.quickReplyButton.displayText)}`;
      if (b.urlButton?.displayText) return `🔗 ${join([b.urlButton.displayText, b.urlButton.url]).replace('\n', ': ')}`;
      if (b.callButton?.displayText) return `📞 ${join([b.callButton.displayText, b.callButton.phoneNumber]).replace('\n', ': ')}`;
      return '';
    })
    .filter(Boolean);
}

/** Botões do formato novo (nativeFlow): o texto vem num JSON (display_text, url, phone_number...). */
function nativeFlowButtons(buttons: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] | null | undefined): string[] {
  return (buttons ?? [])
    .map((b) => {
      let p: Record<string, unknown> = {};
      try {
        p = JSON.parse(b.buttonParamsJson ?? '{}') as Record<string, unknown>;
      } catch {
        /* sem parâmetros legíveis */
      }
      const text = clean((p.display_text as string) ?? (p.title as string) ?? '');
      if (!text) return '';
      if (b.name === 'cta_url' && p.url) return `🔗 ${text}: ${clean(p.url as string)}`;
      if (b.name === 'cta_call' && p.phone_number) return `📞 ${text}: ${clean(p.phone_number as string)}`;
      if (b.name === 'cta_copy' && p.copy_code) return `📋 ${text}: ${clean(p.copy_code as string)}`;
      return `🔘 ${text}`;
    })
    .filter(Boolean);
}

function interactiveText(m: proto.Message.IInteractiveMessage | null | undefined): string {
  if (!m) return '';
  const cards = (m.carouselMessage?.cards ?? []).map((c) => interactiveText(c)).filter(Boolean);
  return join([
    bold(m.header?.title),
    m.header?.subtitle,
    m.body?.text,
    italic(m.footer?.text),
    ...nativeFlowButtons(m.nativeFlowMessage?.buttons),
    ...cards.map((c) => `\n${c}`),
  ]);
}

/** O texto de uma mensagem de template/interativa (ou null, se não for uma delas ou vier vazia). */
export function templateText(content: proto.IMessage | null | undefined): string | null {
  if (!content) return null;
  let text = '';
  const t = content.templateMessage;
  if (t) {
    const h = t.hydratedTemplate ?? t.hydratedFourRowTemplate;
    text = h
      ? join([bold(h.hydratedTitleText), h.hydratedContentText, italic(h.hydratedFooterText), ...hydratedButtons(h.hydratedButtons)])
      : interactiveText(t.interactiveMessageTemplate);
  } else if (content.interactiveMessage) {
    text = interactiveText(content.interactiveMessage);
  } else if (content.buttonsMessage) {
    const b = content.buttonsMessage;
    text = join([
      bold(b.text),
      b.contentText,
      italic(b.footerText),
      ...(b.buttons ?? []).map((x) => (x.buttonText?.displayText ? `🔘 ${clean(x.buttonText.displayText)}` : '')),
    ]);
  } else if (content.listMessage) {
    const l = content.listMessage;
    const rows = (l.sections ?? []).flatMap((s) => [
      s.title && (l.sections?.length ?? 0) > 1 ? bold(s.title) : '',
      ...(s.rows ?? []).map((r) => (r.title ? `▫️ ${join([r.title, r.description]).replace('\n', ' — ')}` : '')),
    ]);
    text = join([bold(l.title), l.description, italic(l.footerText), l.buttonText ? `📋 ${clean(l.buttonText)}` : '', ...rows]);
  } else if (content.templateButtonReplyMessage) {
    text = clean(content.templateButtonReplyMessage.selectedDisplayText);
  } else if (content.buttonsResponseMessage) {
    text = clean(content.buttonsResponseMessage.selectedDisplayText);
  } else if (content.listResponseMessage) {
    const r = content.listResponseMessage;
    text = join([r.title, r.description]);
  } else if (content.interactiveResponseMessage) {
    text = clean(content.interactiveResponseMessage.body?.text);
  }
  return text || null;
}
