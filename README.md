# MonitorGroup – Monitor de grupos de WhatsApp

Sistema web que acompanha as mensagens recebidas e enviadas nos grupos de WhatsApp da sua empresa e garante que **nenhum cliente fique sem resposta**.

- **Conexão por QR code**: conecte o número que participa dos grupos, igual ao WhatsApp Web.
- **Fila "Aguardando resposta"**: mostra em tempo real os grupos em que um cliente escreveu e a equipe ainda não respondeu, ordenados pelo tempo de espera.
- **Dashboard**: tempo médio de primeira resposta, mediana e P90, % dentro do SLA, volume diário (clientes x equipe), distribuição dos tempos de resposta, movimento por hora, ranking dos grupos e desempenho de cada atendente.
- **Alertas configuráveis**: cliente sem resposta há X minutos, palavras-chave ("urgente", "cancelar"…), volume alto de mensagens, grupo parado e WhatsApp desconectado. Os avisos chegam no painel (em tempo real), por **e-mail**, por **WhatsApp** ou por **webhook** (Slack, Teams, n8n, Zapier…).
- **Indicadores configuráveis**: o dashboard é montado a partir de um catálogo de indicadores agrupados em blocos. Em **Configurações › Indicadores** (só administradores) é possível ligar/desligar cada indicador ou bloco, ligar/desligar o alerta, editar os parâmetros e restaurar o padrão. As mudanças valem na hora para todos e ficam registradas (quem e quando). Desligar não apaga dados.
- **Importação do histórico**: ao ler o QR code, as mensagens anteriores dos grupos monitorados (padrão: últimos 30 dias, só texto) são importadas em segundo plano e as métricas do período já aparecem no dashboard. Para um número já conectado, use **Configurações › WhatsApp › Importar histórico** (gera um novo QR code, pois o WhatsApp só envia o histórico na conexão). A conversa de cada grupo carrega 50 mensagens por vez ao rolar.
- **Grupos excluídos**: quando o número conectado sai ou é removido de um grupo, ou o grupo é apagado no celular, ele vai para a aba **Grupos › Excluídos**, sai da fila e dos alertas, mas o histórico continua disponível. O administrador pode excluí-lo definitivamente de lá. Se o número voltar ao grupo, ele é reativado sozinho.
- **Login** com e-mail e senha pré-cadastrados ou com **Google**. Só entra quem um administrador autorizou.
- Tudo roda na nuvem: o navegador é o único programa necessário.

## Arquitetura

```
 Navegador ──► Painel web (Next.js · Vercel) ──► Supabase (Postgres + Auth + Realtime)
                                                     ▲
 WhatsApp ◄──► Worker (Node.js + Baileys · Railway) ─┘
```

| Pasta | O que é | Onde roda |
|---|---|---|
| `supabase/migrations` | Banco de dados: tabelas, segurança (RLS), métricas e regras de negócio | Supabase |
| `worker` | Conecta ao WhatsApp, grava as mensagens dos grupos e dispara os alertas | Railway (ou qualquer serviço que rode Docker 24h) |
| `web` | Painel: login, dashboard, fila, grupos, alertas e configurações | Vercel |

**Como uma conversa é avaliada:** cada mensagem de um grupo é classificada como *cliente* ou *equipe*. Mensagens enviadas pelo número conectado e pelos atendentes cadastrados em **Configurações › Equipe** contam como equipe. Quando um cliente escreve, o grupo entra na fila de pendências. Quando a equipe responde, a pendência fecha e o sistema registra o tempo de resposta, contado a partir da **primeira** mensagem do cliente que ficou sem resposta. Mensagens curtas de agradecimento ("ok", "obrigado", 👍) não abrem uma nova pendência (essa opção pode ser desligada).

---

## Como colocar no ar (cerca de 30 minutos, sem instalar nada)

Todos os passos são feitos pelo navegador. Você vai precisar de contas gratuitas no [GitHub](https://github.com), no [Supabase](https://supabase.com), no [Railway](https://railway.com) e na [Vercel](https://vercel.com).

### 1. Banco de dados e login (Supabase)

1. Em [supabase.com](https://supabase.com), clique em **New project** e escolha a região **South America (São Paulo)**.
2. Abra o **SQL Editor**. Cole e execute **na ordem** o conteúdo de cada arquivo:
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_metrics.sql`
   3. `supabase/migrations/0003_ingest.sql`
   4. `supabase/migrations/0004_profile_fallback.sql`
   5. `supabase/migrations/0005_worker_status.sql`
   6. `supabase/migrations/0006_removed_groups.sql`
   7. `supabase/migrations/0007_history_import.sql`
   8. `supabase/migrations/0008_indicators.sql`
   9. `supabase/migrations/0009_response_block.sql`
   10. `supabase/migrations/0010_demands.sql`
   11. `supabase/migrations/0011_relationship_context.sql`
   12. `supabase/migrations/0012_replies.sql`
   13. `supabase/migrations/0013_worker_lock.sql`
   14. `supabase/migrations/0014_reincidence.sql`
3. Em **Project Settings › API**, anote:
   - `Project URL`
   - `anon public` key
   - `service_role` key (é secreta: nunca coloque no navegador nem a compartilhe)
4. **Login com Google** (opcional):
   1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um *OAuth client ID* do tipo *Web application*.
   2. Em *Authorized redirect URIs*, coloque `https://SEU-PROJETO.supabase.co/auth/v1/callback`.
   3. No Supabase, abra **Authentication › Sign In / Providers › Google**, ative o provedor e cole o *Client ID* e o *Client Secret*.
5. Depois do passo 3 (Vercel), volte em **Authentication › URL Configuration**:
   - **Site URL**: `https://seu-painel.vercel.app`
   - **Redirect URLs**: `https://seu-painel.vercel.app/**`

### 2. Worker do WhatsApp (Railway)

O worker precisa ficar ligado 24 horas por dia, porque mantém a conexão com o WhatsApp aberta. Por isso ele não roda na Vercel.

1. Em [railway.com](https://railway.com), clique em **New Project › Deploy from GitHub repo** e escolha este repositório.
2. No serviço criado, abra **Settings** e defina **Root Directory** = `worker`. O Railway encontra o `Dockerfile` e o `railway.json` sozinho.
3. Em **Variables**, cadastre:

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `APP_URL` | endereço do painel (ex.: `https://seu-painel.vercel.app`), usado nos links dos alertas |
   | `RESEND_API_KEY` | *(opcional)* chave do [Resend](https://resend.com) para os alertas por e-mail |
   | `ALERT_EMAIL_FROM` | *(opcional)* remetente, ex.: `Monitor <alertas@suaempresa.com>` |
   | `ANTHROPIC_API_KEY` | *(opcional)* chave da API do Claude, usada só se a origem "IA" de demandas for ligada |
   | `CLAUDE_MODEL` | *(opcional)* modelo usado na classificação; padrão `claude-opus-5-5` |

4. Faça o deploy e mantenha **1 réplica**. Quando o log mostrar `worker do MonitorGroup no ar`, ele está funcionando.

> A sessão do WhatsApp fica salva no banco (tabela `wa_auth_state`). Assim, reinícios e novos deploys do worker não exigem ler o QR code de novo.
>
> Prefere outra plataforma? O worker é um contêiner Docker comum: funciona no Render (plano pago, que não hiberna), no Fly.io, no Google Cloud Run (com instância mínima = 1) ou numa VPS.

### 3. Painel web (Vercel)

1. Em [vercel.com](https://vercel.com), clique em **Add New › Project** e importe este repositório.
2. Em **Root Directory**, escolha `web`.
3. Em **Environment Variables**, cadastre:

   | Variável | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (usada só no servidor, para criar usuários com senha) |

4. Clique em **Deploy**. Depois, volte ao passo 1.5 e cadastre a URL gerada no Supabase.

### 4. Primeiro acesso

1. Crie o primeiro usuário de uma destas formas:
   - entre com o Google no painel;
   - ou, no Supabase, abra **Authentication › Users › Add user** e marque *Auto confirm*.

   **O primeiro usuário vira administrador automaticamente.**
2. Em **Configurações › WhatsApp**, clique em **Nova conexão** e leia o QR code com o celular (*Aparelhos conectados › Conectar um aparelho*).
3. Os grupos aparecem em **Grupos**. Desligue o monitoramento dos grupos que não são de clientes.
4. Em **Configurações › Equipe**, cadastre os números dos atendentes que respondem pelo próprio celular.
5. Em **Configurações › Geral**, ajuste o horário comercial e o SLA. Depois revise as regras em **Configurações › Regras de alerta**.
6. Em **Configurações › Usuários**, cadastre as outras pessoas:
   - **com senha**: elas entram com e-mail e senha;
   - **sem senha**: elas entram com a conta Google desse e-mail.

## Demandas

Uma demanda é um pedido do cliente acompanhado até a entrega. Ela pode nascer de três origens, cada uma ligada ou desligada em **Configurações › Geral › Demandas** (somente admin):

- **Manual**: botão *Nova demanda* em **Demandas** ou *criar demanda* sobre uma mensagem na conversa do grupo.
- **Comandos e palavras-chave**: a equipe escreve no grupo (de preferência respondendo à mensagem do cliente):

  | Comando | Efeito |
  |---|---|
  | `#demanda descrição até sexta` | abre a demanda (o prazo é opcional) |
  | `#andamento` | marca como em andamento |
  | `#entregue` | marca como entregue |
  | `#cancelada` | cancela |
  | `#prazo 15/10 14h` | define ou altera o prazo prometido |
  | `#confirmada` | registra a confirmação do cliente |

  Sem resposta a uma mensagem, o comando vale para a demanda aberta mais recente do grupo. Palavras-chave do cliente (lista editável) também podem abrir demandas.
- **IA** (desligada por padrão): o Claude classifica mensagens pendentes dos clientes. Requer `ANTHROPIC_API_KEY` no worker. Mensagens que o modelo recusar são tratadas como não-demanda.

O worker também detecta sozinho: prazo prometido pela equipe ("até amanhã", "em 2 dias"), cobranças do cliente, reabertura e confirmação após a entrega. As palavras usadas ficam nos parâmetros dos indicadores *Retrabalho* e *Confirmação do cliente*.

## Responder pelo sistema

Ative em **Configurações › Geral › Responder pelo sistema** (somente admin). A conversa de cada grupo monitorado ganha uma caixa de resposta, e cada mensagem tem a opção **responder**, que cita a mensagem original como no WhatsApp.

- A mensagem vai para uma fila e o worker a envia pelo **número conectado**. Como o painel é um aparelho conectado ao número (igual ao WhatsApp Web), a mensagem **aparece também no celular**. O caminho contrário já existia: o que é enviado pelo celular aparece no painel.
- **Assinar com o nome** (ligado por padrão): a mensagem começa com `*Nome:*`, para o cliente saber quem respondeu. No painel e nos indicadores, a resposta conta para quem a escreveu.
- **Quem pode responder**: todos os usuários ou só administradores. A regra é conferida no banco.
- A tela mostra o andamento de cada envio: na fila, enviando, enviada ou não enviada. Se o envio falhar, há as opções **Tentar de novo** e **Descartar**. Mensagens que não saírem em 10 minutos (WhatsApp desconectado) são marcadas como não enviadas, para não chegarem atrasadas ao cliente.

## Relatórios

A página **Relatórios** mostra os indicadores ativos em forma de tabela, com os mesmos filtros do dashboard (período, grupo e atendente). Dá para:

- **Exportar relatório (CSV)**: um arquivo com uma seção por indicador, pronto para abrir no Excel;
- **Lista detalhada (CSV)**: as mensagens ou demandas que compõem cada indicador;
- **Imprimir / PDF**: imprime só o conteúdo da página.

Indicadores desligados não aparecem no relatório nem podem ser exportados.

## Como criar um indicador novo

1. Crie a função de cálculo `public.ind_<chave>(f jsonb, p jsonb) returns jsonb`, devolvendo um dos formatos padrão (`kpi`, `table`, `series`, `bars`, `heatmap` — veja o cabeçalho de `0008_indicators.sql`). `f` traz os filtros (`from`, `to`, `group_id`, `member_id`, `tz`, horário comercial e feriados) e `p` os parâmetros do indicador.
   Nas tabelas, cada coluna aceita `format` (`number`, `duration`, `percent`, `percent_delta`, `datetime`, `text` ou `spark`, uma lista de números desenhada como mini gráfico), `bar`, `highlight_abs_gte` e `warn_below`.
2. (Opcional) Crie `public.ind_<chave>_details(f, p)` devolvendo `{columns, rows}` para a lista exibida ao clicar no indicador.
3. Insira o registro em `public.indicators` (bloco, nome, visual, tamanho, `default_params` e `param_schema`).

Não é preciso mexer no painel: a tela de configurações e o dashboard leem o catálogo.

## Problemas no login

A tela de login mostra o motivo do erro. Os casos mais comuns:

| Mensagem | O que fazer |
|---|---|
| *Configuração incompleta* | Cadastre `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` na Vercel e faça **Redeploy** (variáveis novas só valem após um novo deploy). |
| *E-mail ou senha incorretos* | Confira os dados ou recrie o usuário em **Authentication › Users** marcando *Auto confirm user*. |
| *E-mail ainda não confirmado* | Em **Authentication › Users**, confirme o usuário ou recrie com *Auto confirm user*. |
| *Não foi possível conectar ao Supabase* | URL errada ou projeto pausado (projetos gratuitos pausam após 7 dias sem uso; reative no painel do Supabase). |
| *Banco de dados não preparado* | Execute os scripts `0001` a `0004` no SQL Editor. |
| *Acesso não liberado* | O e-mail não está autorizado; um administrador precisa cadastrá-lo em **Configurações › Usuários**. |
| Volta para o login após entrar com Google | Configure **Site URL** e **Redirect URLs** em **Authentication › URL Configuration**. |

Criou o usuário antes de rodar os scripts? Basta executar o `0004`: ele cria os perfis que faltam e torna administrador o usuário mais antigo.

## Atualizar o banco depois de uma nova versão

Em vez de rodar os scripts um a um, execute no SQL Editor do Supabase o arquivo **`supabase/atualizar_banco.sql`**. Ele junta todos os scripts a partir do 0002, na ordem certa, e pode ser executado quantas vezes quiser: o que já existe é mantido e o que falta é criado. Erros como `function public.business_seconds(...) does not exist` acontecem quando um script é rodado antes de outro anterior; o arquivo único evita isso.

Ao terminar, o SQL Editor mostra uma tabela de conferência: todas as linhas com **OK** significam banco atualizado. A mensagem "Success. No rows returned" em scripts isolados também indica sucesso (scripts que criam tabelas não devolvem linhas). Para só conferir, sem executar tudo de novo, rode `supabase/conferir_banco.sql`.

Quem altera os scripts gera os arquivos de novo com `sh supabase/build-updates.sh`.

## "Could not find the '...' column … in the schema cache"

Uma função nova do painel está usando campos que o banco ainda não tem: falta executar um script SQL. No SQL Editor do Supabase, execute os scripts da pasta `supabase/migrations` que ainda não rodou, **na ordem** (veja a lista no passo 1). Os scripts podem ser executados de novo sem problema. Se o erro continuar logo depois, rode `notify pgrst, 'reload schema';` no SQL Editor e aguarde alguns segundos.

## QR code não aparece

A tela **Configurações › WhatsApp** mostra no topo se o worker está no ar:

- **"O worker do WhatsApp está fora do ar" / "ainda não se conectou"**: o serviço no Railway não está rodando ou não alcança o banco. Confira se o deploy terminou e o log mostra `worker do MonitorGroup no ar`, se o **Root Directory** é `worker` e as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (chave *service_role*, não a anon). Após mudar variáveis, faça novo deploy.
- **Log do Railway com "não foi possível ler o banco"**: URL/chave erradas ou scripts SQL não executados.
- **Worker no ar, mas a conexão mostra "Reconectando… código 405/403"**: o WhatsApp recusou a conexão. Aguarde alguns minutos e clique em **Tentar novamente**; se persistir, faça um novo deploy do worker (ele busca a versão mais recente do WhatsApp Web ao iniciar).
- **"O WhatsApp encerrou a conexão… (código 428: Connection Terminated)"**: quase sempre há **duas cópias do worker** usando a mesma conexão. Isso acontece com mais de 1 réplica no Railway ou com o worker rodando também no seu computador com as mesmas variáveis. Também pode ser um bloqueio temporário após muitas tentativas seguidas. Para resolver:
  1. No Railway, abra o serviço do worker › **Settings › Deploy** e confira **Replicas = 1**. Se houver um segundo serviço do worker (projeto duplicado), remova-o.
  2. Pare qualquer `npm run dev`/`npm start` do worker no seu computador.
  3. Execute o script `0013_worker_lock.sql` e faça um novo deploy. A partir dele só uma cópia se conecta por vez; uma cópia extra fica aguardando e aparece como aviso nesta tela.
  4. Aguarde 10 a 15 minutos e clique em **Conectar**. Leia o QR code assim que aparecer.
  5. O worker anuncia a versão atual do WhatsApp Web (buscada em web.whatsapp.com; aparece no topo de **Configurações › WhatsApp**) e, se o pareamento falhar, alterna para um perfil de conexão mais simples. Se ainda assim falhar, a mensagem de erro traz um "Diagnóstico da última tentativa" (versão, perfil e em quantos segundos a conexão caiu): envie esse texto ao suporte.
- **"Não foi possível verificar o worker"**: execute o script `0005_worker_status.sql`.

## Custos estimados

| Serviço | Plano | Custo |
|---|---|---|
| Supabase | Free (500 MB de banco) | US$ 0. O plano Pro (US$ 25/mês) é indicado para alto volume e backups diários |
| Railway | Hobby | cerca de US$ 5/mês |
| Vercel | Hobby / Pro | US$ 0 para testes. O plano Pro (US$ 20/mês) é exigido para uso comercial |
| Resend | Free | US$ 0 até 3.000 e-mails/mês |

## Segurança e boas práticas

- O sistema usa o WhatsApp Web de forma **não oficial** (biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys)). Ele **só lê** os grupos e envia apenas as notificações de alerta que você configurar. Mesmo assim, o WhatsApp pode restringir números com comportamento suspeito. Use um número da empresa e não use o sistema para disparos em massa.
- Todas as tabelas usam *Row Level Security*. Só usuários autorizados (ativos) leem os dados, e só administradores alteram as conexões, as regras e os usuários. A sessão do WhatsApp só é acessível ao worker.
- Quem entra com uma conta Google não autorizada vê a tela *"Acesso não liberado"* e não consegue ler nenhum dado.
- Guarde a `service_role` key apenas nas variáveis de ambiente do Railway e da Vercel.

## Desenvolvimento local (opcional)

```bash
# banco local (requer Docker + Supabase CLI)
npx supabase start            # aplica as migrations de supabase/migrations

# worker
cd worker && cp .env.example .env   # preencha com as chaves do Supabase
npm install && npm run dev
npm test

# painel
cd web && cp .env.example .env.local
npm install && npm run dev    # http://localhost:3000
```
