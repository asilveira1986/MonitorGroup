# MonitorGroup – Monitor de grupos de WhatsApp

Sistema web que acompanha as mensagens recebidas e enviadas nos grupos de WhatsApp da sua empresa e garante que **nenhum cliente fique sem resposta**.

- **Conexão por QR code**: conecte o número que participa dos grupos, igual ao WhatsApp Web.
- **Fila "Aguardando resposta"**: mostra em tempo real os grupos em que um cliente escreveu e a equipe ainda não respondeu, ordenados pelo tempo de espera.
- **Dashboard**: tempo médio de primeira resposta, mediana e P90, % dentro do SLA, volume diário (clientes x equipe), distribuição dos tempos de resposta, movimento por hora, ranking dos grupos e desempenho de cada atendente.
- **Alertas configuráveis**: cliente sem resposta há X minutos, palavras-chave ("urgente", "cancelar"…), volume alto de mensagens, grupo parado e WhatsApp desconectado. Os avisos chegam no painel (em tempo real), por **e-mail**, por **WhatsApp** ou por **webhook** (Slack, Teams, n8n, Zapier…).
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

## QR code não aparece

A tela **Configurações › WhatsApp** mostra no topo se o worker está no ar:

- **"O worker do WhatsApp está fora do ar" / "ainda não se conectou"**: o serviço no Railway não está rodando ou não alcança o banco. Confira se o deploy terminou e o log mostra `worker do MonitorGroup no ar`, se o **Root Directory** é `worker` e as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (chave *service_role*, não a anon). Após mudar variáveis, faça novo deploy.
- **Log do Railway com "não foi possível ler o banco"**: URL/chave erradas ou scripts SQL não executados.
- **Worker no ar, mas a conexão mostra "Reconectando… código 405/403"**: o WhatsApp recusou a conexão. Aguarde alguns minutos e clique em **Tentar novamente**; se persistir, faça um novo deploy do worker (ele busca a versão mais recente do WhatsApp Web ao iniciar).
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
