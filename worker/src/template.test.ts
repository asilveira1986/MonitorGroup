import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { proto } from 'baileys';
import { extractContent } from './text.js';

const read = (m: proto.IMessage) => extractContent(m);

test('template (aviso do WhatsApp Business): título, texto, rodapé e botões', () => {
  assert.deepEqual(
    read({
      templateMessage: {
        hydratedTemplate: {
          hydratedTitleText: 'Pedido confirmado',
          hydratedContentText: 'Olá, Ana! Seu pedido 123 foi confirmado.',
          hydratedFooterText: 'Loja X',
          hydratedButtons: [
            { quickReplyButton: { displayText: 'Falar com atendente', id: '1' } },
            { urlButton: { displayText: 'Acompanhar', url: 'https://loja.x/123' } },
            { callButton: { displayText: 'Ligar', phoneNumber: '+5511999998888' } },
          ],
        },
      },
    }),
    {
      type: 'text',
      body: '*Pedido confirmado*\nOlá, Ana! Seu pedido 123 foi confirmado.\n_Loja X_\n🔘 Falar com atendente\n🔗 Acompanhar: https://loja.x/123\n📞 Ligar: +5511999998888',
    },
  );
});

test('template dentro de "ver uma vez" e interativo com botões novos', () => {
  const r = read({
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: { title: 'Boleto disponível' },
          body: { text: 'Vencimento 10/11' },
          footer: { text: 'Financeiro' },
          nativeFlowMessage: {
            buttons: [
              { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copiar código', copy_code: '34191.79001' }) },
              { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Já paguei', id: 'x' }) },
            ],
          },
        },
      },
    },
  });
  assert.deepEqual(r, { type: 'text', body: '*Boleto disponível*\nVencimento 10/11\n_Financeiro_\n📋 Copiar código: 34191.79001\n🔘 Já paguei' });
});

test('botões, lista e as respostas a eles', () => {
  assert.equal(
    read({ buttonsMessage: { contentText: 'Confirma a visita?', footerText: 'Agenda', buttons: [{ buttonText: { displayText: 'Sim' } }, { buttonText: { displayText: 'Não' } }] } })?.body,
    'Confirma a visita?\n_Agenda_\n🔘 Sim\n🔘 Não',
  );
  assert.equal(
    read({ listMessage: { title: 'Menu', description: 'Escolha', buttonText: 'Opções', sections: [{ rows: [{ title: 'Boleto' }, { title: 'Suporte', description: 'técnico' }] }] } })?.body,
    '*Menu*\nEscolha\n📋 Opções\n▫️ Boleto\n▫️ Suporte — técnico',
  );
  assert.deepEqual(read({ templateButtonReplyMessage: { selectedDisplayText: 'Falar com atendente' } }), { type: 'text', body: 'Falar com atendente' });
  assert.deepEqual(read({ buttonsResponseMessage: { selectedDisplayText: 'Sim' } }), { type: 'text', body: 'Sim' });
  assert.deepEqual(read({ listResponseMessage: { title: 'Boleto' } }), { type: 'text', body: 'Boleto' });
});

test('template sem texto continua como template', () => {
  assert.deepEqual(read({ templateMessage: { hydratedTemplate: {} } }), { type: 'template', body: null });
});
