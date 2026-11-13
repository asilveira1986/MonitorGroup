# Melhorias registradas

Ideias combinadas e ainda não feitas. Cada item diz o que é, por que e o que já se sabe.

## Tique de mensagens enviadas por outros números (registrada em 13/11/2026)

**Situação hoje.** No grupo, só as mensagens do número conectado mostram tique (✓ enviada, ✓✓ entregue, azul lida; ao passar o mouse, quantos receberam e quem leu). Mensagens da equipe enviadas do celular pessoal de outra pessoa não mostram nada, e isso parece falha para quem usa o painel.

**Por que não dá para ter o tique.** O WhatsApp manda enviada/entregue/lida só ao aparelho de quem enviou. O sistema é um aparelho vinculado ao número conectado, então recebe os avisos desse número (enviadas pelo painel ou pelo celular dele), e de mais nenhum.

**Melhoria combinada.**
1. Nas mensagens da equipe que **não** são do número conectado, mostrar um indicador claro no lugar do vazio, por exemplo "enviada de outro número, sem confirmação" (dica ao passar o mouse explicando o motivo).
2. Opcional: conectar o número da pessoa como mais um número do sistema (como o Cível e o Trabalhista), para as mensagens enviadas por ele terem tique nos grupos em que ele está. Cada pessoa precisa aceitar o QR e fica mais um número para manter conectado.

**Onde mexer.** `web/src/app/(app)/groups/[id]/conversation.tsx` (componente `Ticks`, usado só quando `m.from_me`); o worker já grava `wa_status` e `message_receipts` (`worker/src/whatsapp.ts`, `saveWaStatus` e `saveReceipt`).
