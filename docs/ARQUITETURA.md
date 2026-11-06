# Guia de manutenção do MonitorGroup

Para quem vai mexer no código. O [README](../README.md) explica o produto e como colocar no ar; este guia explica **onde
fica cada coisa, como fazer as mudanças mais comuns e o que não pode ser esquecido**.

## 1. Visão geral

```
 Navegador ──► Painel (web/ · Next.js · Vercel) ──► Supabase (Postgres + Auth + Realtime + Storage)
                                                        ▲
 WhatsApp ◄──► Worker (worker/ · Node + Baileys · Railway) ─┘
```

- O **painel** lê e grava no Supabase com a sessão de quem está logado; as permissões ficam no banco (RLS e funções).
- O **worker** usa a chave de serviço, **nunca** é chamado pelo painel: os dois só conversam pelo banco. O painel
  grava numa fila (por exemplo `outgoing_messages`) e o worker, que fica consultando, envia pelo WhatsApp.
- O tempo real do painel (avisos em tela, contadores) é o **Realtime do Supabase**: gravar numa tabela já avisa as telas.
- O worker precisa estar **sempre ligado** (uma só cópia por vez: há uma trava no banco). O painel é *serverless*.

| Pasta | O que é | Raiz do deploy |
|---|---|---|
| `supabase/migrations` | Banco: tabelas, RLS, funções, métricas | SQL Editor do Supabase (scripts gerados) |
| `worker` | Conexão com o WhatsApp, filas, alertas, automação | Railway (`worker/Dockerfile`) |
| `web` | Painel | Vercel (Root Directory = `web`) |
| `docs` | Este guia | – |
| `scripts` | `check.sh`: roda tudo o que o CI roda | – |

## 2. Worker (`worker/src`)

Uma pasta com um arquivo por assunto. O ponto de entrada é `index.ts`; quase tudo passa por `whatsapp.ts`.

| Assunto | Arquivos |
|---|---|
| **Núcleo** | `index.ts` (início, trava de cópia única, tarefas periódicas), `whatsapp.ts` (uma conexão Baileys por número: entrada das mensagens e envio das filas), `env.ts`, `db.ts` (cliente Supabase e tipos de linha), `cache.ts` (configurações, equipe e empresas em memória), `auth-state.ts` (sessão do WhatsApp no Postgres), `connection-profile.ts`, `logger.ts` |
| **Ler uma mensagem** | `text.ts` (texto, tipo, citação, reação, edição, menções), `template.ts` (templates e botões), `media.ts` + `media-info.ts` (arquivos), `audio.ts`, `avatars.ts`, `receipts.ts`, `private.ts` + `private-jid.ts` (conversas privadas e contatos) |
| **Regras de negócio** | `acknowledgement.ts` (o que ignorar: "ok", "obrigado"), `commitment.ts` (equipe assumiu uma tarefa), `closing.ts`, `dates.ts` (prazos em português), `demands.ts` + `ai.ts` (demandas e IA), `business-hours.ts`, `duration.ts` |
| **Alertas e avisos** | `alerts.ts` (regras de alerta, a cada minuto e a cada mensagem), `recipients.ts` (quem recebe), `notify.ts` (WhatsApp, e-mail, webhook), `push.ts` (push), `team-whatsapp.ts` (avisos à equipe), `after-hours.ts` (grupo de alertas fora do expediente) |
| **Automação de atendimento** | `automation/` — `service.ts` (regras de negócio), `store.ts` (Supabase), `sender.ts` (fila de envio), `hours.ts`, `setup.ts`, `types.ts` |
| **Mensagem de encerramento** | `closing-flow/` — `service.ts` (agenda após o fechamento, lê voto/resposta digitada, ações), `poll.ts` (decifra o voto da enquete), `store.ts`, `setup.ts`, `types.ts`. O “botão” é uma **enquete**: o WhatsApp não entrega botões a números comuns em grupos |
| **Disparos em massa** | `broadcast/` — `service.ts` (variáveis do texto, intervalos, limites; puro), `runner.ts` (ciclo de envio: um por número com intervalo aleatório, pausa por lote, limite de 24 h, pausa automática após falhas seguidas), `store.ts` (Supabase), `setup.ts`. O eco da mensagem enviada é ignorado em `whatsapp.ts` (`setBroadcast`), como na automação |
| **Limpeza** | `cleanup.ts` |

Cada arquivo de regra tem um teste ao lado (`*.test.ts`). A automação é testada com banco, envio e relógio simulados
(`automation/automation.test.ts`), o que permite testar sem WhatsApp.

## 3. Painel (`web/src`)

| Onde | O que tem |
|---|---|
| `app/(app)/<tela>/page.tsx` | Uma pasta por tela: `dashboard`, `broadcasts` (disparos: lista, `new/`, `[id]/`), `panel`, `groups`, `pending`, `alerts`, `demands`, `agenda`, `private`, `contacts`, `reports`, `acompanhamento`, `logs`, `platform`, `profile` e `settings` |
| `app/(app)/settings/*` | Uma pasta por página de configuração; `automation/` é a automação de atendimento |
| `app/(app)/settings/actions/*.ts` | **Ações do servidor das configurações, uma por assunto**: `company`, `images`, `whatsapp`, `alerts`, `replies`, `users`, `people`, `demand-types`, `indicators`, `sectors`, `menus` |
| `app/(app)/*/actions.ts` | Ações das outras telas (grupos, agenda, demandas, privado, perfil) |
| `components/` | Peças compartilhadas: `ui.tsx` (botões, campos, cartões), `message-notifier.tsx` (avisos em tela), `sidebar.tsx`, gráficos e indicadores |
| `lib/` | Regras sem tela (veja abaixo) |

Módulos de `lib/` que mais se usa:

- `app-settings.ts`: **configurações da empresa, uma leitura por requisição**. Use `appSettings()`; não consulte
  `app_settings` direto nas páginas.
- `auth.ts`: `requireProfile`, `requireAdmin`, `requireMenu`.
- `action-result.ts`: tipo e auxiliar de resposta das ações (`dbResult`), com a mensagem "rode o script SQL".
- `format.ts`: formatação de datas, tempos, telefones, tamanhos e iniciais. Antes de criar um formatador, procure aqui.
- `settings-nav.ts`: menu das Configurações. `types.ts`: tipos das linhas do banco.
- `mentions.ts`, `quick-replies.ts`, `automation-rules.ts`, `broadcast.ts`: lógica sem tela, com testes (`*.test.ts`).

## 4. Banco (`supabase/migrations`)

- Um arquivo por mudança, numerado e **só para a frente**: `0149_nome.sql`. Nunca edite uma migração antiga.
- Escreva para poder rodar de novo (`if not exists`, `create or replace`, `drop ... if exists`). Quem atualiza o banco
  roda o script completo outra vez.
- Em geral, funções do painel usam `security invoker` (respeitam o RLS) e funções só do worker, `security definer` com
  `grant ... to service_role`; siga o padrão de uma função parecida.
- **Depois de criar uma migração:** (1) acrescente o item de conferência em `supabase/build-updates.sh`, (2) liste o
  arquivo na seção de scripts do README, (3) rode `sh supabase/build-updates.sh`, que gera `atualizar_banco*.sql` e
  `conferir_banco.sql`. Commite os arquivos gerados junto.
- Uma tela que usa uma coluna nova deve funcionar (mostrar o aviso "rode o script") quando o script ainda não foi rodado.
  Por isso `appSettings()` lê `select('*')` e as ações passam o erro por `dbResult`.

## 5. Receitas

**Nova configuração da empresa (liga/desliga ou valor):**
1. Migração com `alter table public.app_settings add column if not exists ...` (+ item em `build-updates.sh`).
2. Ação em `web/src/app/(app)/settings/actions/<assunto>.ts` (`requireAdmin`, `update` em `app_settings`, `dbResult`).
3. Leia com `appSettings()` na página; mostre com um `Toggle`/`Field` de `components/ui.tsx`.
4. Se o worker usa: leia em `cache.ts` (`getSettings`), que renova a cada minuto.

**Nova ação do servidor:** coloque no arquivo do assunto em `settings/actions/` (ou no `actions.ts` da tela). O arquivo
começa com `'use server'` e **só pode exportar funções `async` e tipos**; auxiliares ficam sem `export`.

**Novo tipo de alerta:** `alerts.type` é texto livre (as regras de `alert_rules.type` têm lista própria). Dê um rótulo em
`ALERT_TYPE_LABEL` (`lib/format.ts`) e trate no `message-notifier.tsx` se precisar de comportamento próprio.

**Nova fila do painel para o worker:** tabela com `status` (`pending`/`sending`/`sent`/`failed`) e índice parcial em
`pending` (veja `outgoing_messages`); o worker reserva a linha (`update ... where status = 'pending'`) antes de enviar.

**Algo novo no worker:** crie o arquivo ao lado do assunto, com o teste ao lado, e ligue em `whatsapp.ts` ou `index.ts`.
Prefira funções puras (sem banco) para a regra e uma camada fina para o banco, como em `automation/`.

## 6. Verificar antes de publicar

```bash
sh scripts/check.sh      # tipos, testes, lint e build do worker e do painel (o mesmo do CI)
```

O CI (`.github/workflows/ci.yml`) roda isso a cada envio. Dependências instaladas com `npm ci` (use `npm install` só
para mudar dependências).

## 7. Armadilhas conhecidas

- **Cópias idênticas entre os pacotes:** `acknowledgement.ts` e `commitment.ts` existem em `worker/src` e `web/src/lib`
  (cada pacote é implantado à parte). Mude os dois; os testes `acknowledgement.test.ts` e `commitment.test.ts` falham
  se divergirem.
- **Mensagem do número conectado conta como equipe.** Por isso as mensagens da automação (acuse, aviso, cobrança) têm o
  id registrado e são ignoradas na entrada (`automation/service.ts`, `BotRegistry`); ao enviar outra coisa
  automaticamente pelo worker, faça o mesmo ou ela encerrará pendências.
- **`useRealtime` e `router.refresh`:** o painel já atualiza por Realtime em várias telas; não acrescente `setInterval`
  de recarga sem necessidade.
- **Cache do worker:** configurações, equipe e empresas ficam em memória e renovam sozinhas (cerca de 1 minuto).
  Uma mudança no painel pode levar esse tempo para valer no worker; a automação lê a chave geral a cada 30 s.
- **Mensagens e textos da tela em português.** Erros devolvidos pelas ações são mostrados ao usuário como estão.
- **Vercel x Railway:** o painel não pode enviar WhatsApp nem rodar tarefas contínuas; tudo que precisa do número
  conectado fica no worker.

## 8. Próximos passos sugeridos (não feitos de propósito)

São mudanças maiores, que valem fazer com o sistema rodando para conferir o comportamento:

- **Dividir `worker/src/whatsapp.ts` (≈2.000 linhas)**: a classe mistura conexão, entrada de mensagens, filas de envio,
  histórico e conversas privadas. Um primeiro corte seguro é extrair as filas de envio (`processOutbox`, `processPrivate*`)
  e a importação do histórico para arquivos próprios, mantendo a classe como orquestradora.
- **Agrupar `worker/src` em pastas por assunto** (como já é `automation/`): `messages/`, `alerts/`, `rules/`.
- **Dividir telas muito grandes** (`private/inbox.tsx`, `message-notifier.tsx`, `agenda/event-controls.tsx`,
  `groups/[id]/conversation.tsx`) em componentes menores.
