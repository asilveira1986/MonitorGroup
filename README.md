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

**Como uma conversa é avaliada:** cada mensagem de um grupo é classificada como *cliente* ou *equipe*. Mensagens enviadas pelo número conectado e pelos atendentes cadastrados em **Configurações › Equipe** contam como equipe. Quando um cliente escreve, o grupo entra na fila de pendências. Quando a equipe responde, a pendência fecha e o sistema registra o tempo de resposta, contado a partir da **última** mensagem do cliente antes da resposta. A fila de pendências e os alertas de "sem resposta" continuam contando a espera desde a primeira mensagem não respondida. Mensagens curtas de agradecimento ("ok", "obrigado", 👍) não abrem uma nova pendência (essa opção pode ser desligada).

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
   15. `supabase/migrations/0015_recurrence_alert.sql`
   16. `supabase/migrations/0016_peak_hours.sql`
   17. `supabase/migrations/0017_dashboard_cards.sql`
   18. `supabase/migrations/0018_response_from_last_message.sql`
   19. `supabase/migrations/0019_reply_analysis.sql`
   20. `supabase/migrations/0020_media_seen.sql`
   21. `supabase/migrations/0021_conversations.sql`
   22. `supabase/migrations/0022_daily.sql`
   23. `supabase/migrations/0023_groups_panel.sql`
   24. `supabase/migrations/0024_message_alert.sql`
   25. `supabase/migrations/0025_sla_screen_alerts.sql`
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

## Painel de grupos

Menu **Painel de grupos**: cada grupo monitorado num cartão compacto, só com o nome do grupo, quantas mensagens de clientes chegaram hoje e, se houver, quantas estão sem resposta. Clicar no cartão abre o grupo. A cor mostra a situação:

| Cor | Situação |
|---|---|
| **Vermelho** | mensagem sem resposta e o tempo de resposta (SLA do grupo ou o padrão) já foi excedido |
| **Amarelo** | mensagem sem resposta, ainda dentro do tempo de resposta |
| **Verde** | teve mensagem de cliente hoje e tudo foi respondido |
| **Neutro** | nenhuma mensagem de cliente hoje |

O SLA segue a mesma regra dos indicadores (tempo útil, se essa opção estiver ligada). Os atrasados aparecem primeiro; dá para filtrar por situação e buscar pelo nome. O painel se atualiza sozinho a cada mensagem nova e a cada minuto, então um cartão amarelo vira vermelho assim que o tempo de resposta estoura. Mensagens curtas só de agradecimento ou confirmação ("Recebi, obrigado!", "show, valeu 👍") não deixam o grupo aguardando resposta.

## Alertas em tela

Com o painel aberto, os avisos abrem **grandes, no centro da tela**, todos no mesmo formato (fundo escurecido, borda pulsando, ícone balançando, bipe e título da aba piscando), com o grupo e a mensagem e os botões **Abrir grupo** e **Fechar** (ou Esc):

| Aviso | Cor | Quando |
|---|---|---|
| **Nova mensagem** | verde | um cliente escreveu num grupo monitorado |
| **SLA excedido** | vermelho | a mensagem do cliente passou do tempo de resposta (SLA do grupo ou o padrão, em tempo útil se essa opção estiver ligada); mostra quem enviou, a mensagem e há quanto tempo espera |
| **Alertas do sistema** | pela gravidade (vermelho, amarelo ou azul) | o sistema criou um alerta: cliente sem resposta, palavra-chave, WhatsApp desconectado, grupo sem movimentação, prazo vencido, retrabalho, reincidência… |

Um aviso por vez; o mesmo grupo/assunto atualiza o aviso anterior ("cliente sem resposta" e "SLA excedido" do mesmo grupo viram um aviso só). O SLA é conferido a cada 30 segundos e avisa na virada; pendências que já estavam vencidas quando a tela foi aberta não abrem aviso (continuam no Painel de grupos e em Aguardando resposta). Mensagens da equipe e a importação do histórico não geram aviso.

A configuração fica em **Configurações › Geral › Alertas em tela** (só administradores alteram; vale para todos):

- **Mostrar o alerta de nova mensagem** (ligado/desligado);
- **Abrir também os alertas (SLA excedido e alertas do sistema)**; desligado, os alertas do sistema aparecem só como um aviso pequeno no canto;
- **Tempo na tela**: *deixar na tela até fechar* ou *fechar sozinho* depois de 5 s, 10 s, 15 s, 30 s, 1, 2 ou 5 minutos (com contagem, que pausa com o mouse sobre o aviso);
- **Tocar som** (o navegador só libera o som depois do primeiro clique na página);
- **Testar alerta** mostra um aviso de exemplo com a configuração salva.

O sino no topo da tela silencia todos os avisos em tela só no navegador em uso.

## Acompanhamento do dia a dia

O dashboard abre em **Hoje** e foi pensado para acompanhar o dia de perto:

- **Períodos**: **Hoje**, **Ontem**, 7, 30 e 90 dias. Um dia específico pode ser aberto pelo endereço (`?period=day&date=AAAA-MM-DD`).
- **Comparação**: cada número mostra a variação em relação a **ontem até esta mesma hora** (num dia passado, ao dia anterior inteiro; nos períodos de vários dias, ao período anterior do mesmo tamanho). Ex.: "▲ 12 (+30%) vs ontem até esta hora · era 40". Números de "agora", como pendências, não mostram comparação.
- **Bloco Acompanhamento do dia**, no topo:
  - **O dia hora a hora**: mensagens recebidas, respostas da equipe e pendentes no fim de cada hora (em períodos de vários dias, um ponto por dia), com o horário de pico.
  - **Tempo de resposta hora a hora**: tempo médio e pior tempo em cada hora, para ver quando o atendimento fica lento.
  - **Grupos no dia**: cada grupo numa linha com recebidas, respostas, tempo médio, SLA, pendentes agora, há quanto tempo esperam e a primeira e a última mensagem; os grupos com pendência aparecem primeiro.

O Modo TV também abre em Hoje. Os relatórios continuam abrindo em 7 dias, mas aceitam Hoje e Ontem.

## Detalhamento dos indicadores

Clicar num cartão abre a análise em tela cheia com o que compõe o número: uma linha por registro, sem agrupamentos. Nas tabelas que têm grupo, a última coluna traz o botão **Ver grupo**, que abre a conversa do grupo (o botão fica fixo à direita mesmo quando a tabela rola para o lado).

## Ciclo das conversas (início e fechamento)

O bloco **Ciclo das conversas** mostra quando as conversas começam nos grupos e como terminam.

- **Início**: a primeira mensagem que pede atenção quando não há conversa aberta no grupo. Pode ser do cliente (agradecimentos, risadas e emojis não abrem conversa) ou da equipe (dá para desligar nas configurações).
- **Fechamento por encerramento**: o cliente agradece ou confirma ("obrigado", "deu certo", "recebi") depois que a equipe participou, ou a equipe encerra ("qualquer dúvida estamos à disposição", "resolvido").
- **Fechamento por compromisso de retorno**: a equipe se compromete a voltar ("vou verificar e te retorno", "te aviso assim que"). A análise mostra se a equipe voltou a falar no grupo depois (**retorno pendente** quando ainda não voltou). A mensagem do retorno não abre uma conversa nova.
- **Sem fechamento**: a conversa ficou parada mais que o limite (padrão 24 horas) sem encerramento nem compromisso.

O cartão **Início e fechamento das conversas** mostra quantas conversas começaram no período, o percentual fechado, o tempo médio até fechar e as conversas que ainda não fecharam. Na tela cheia, cada conversa aparece numa linha com grupo, quem iniciou, início, situação, fechamento, duração, mensagens e retorno do compromisso. O gráfico **Conversas por dia** compara, dia a dia, as iniciadas, encerradas, com compromisso e sem fechamento. As listas de palavras, o limite de horas e a meta ficam em **Configurações › Indicadores**.

## Imagens e arquivos sem visualização

O cartão **Imagens e arquivos sem visualização** lista as imagens, documentos, vídeos e áudios enviados pelos clientes nos últimos 7 dias que ninguém viu. Um arquivo sai da lista quando:

- **a conversa do grupo é lida no celular conectado**: o WhatsApp avisa o worker (confirmação de leitura do próprio aparelho) e tudo o que chegou até ali conta como visto; ou
- **alguém dá baixa no painel**: botão **dar baixa** no cartão ou ao lado do arquivo na conversa do grupo (fica registrado quem deu baixa e quando).

Arquivos parados há mais de 4 horas aparecem em vermelho. Em **Configurações › Indicadores** dá para mudar os dias considerados e o tempo do destaque. A tela cheia mostra também os já vistos, com quando, como e por quem. Leituras feitas em outros celulares da equipe (com outro número) não chegam ao sistema; nesses casos, dê baixa pelo painel.

## Precisa de resposta? (análise das últimas mensagens)

O indicador **Precisa de resposta?**, no bloco Capacidade de resposta, olha as últimas mensagens dos clientes em cada grupo depois da última mensagem da equipe e classifica a conversa por regras (sem IA e sem custo):

| Resultado | Quando |
|---|---|
| **Precisa** | pergunta (com "?" ou começando com "qual", "quando", "vocês conseguem"…), pedido ("preciso", "por favor", "boleto"…), problema ou urgência ("não funciona", "urgente", "cadê"…), ou o cliente respondeu a uma pergunta da equipe. Prioridade **alta** com urgência, fora do SLA ou quando o cliente insistiu 3 vezes ou mais. |
| **Verificar** | áudio, arquivo sem texto, só cumprimento ("bom dia pessoal"), ou o cliente encerrou com "ok"/"obrigado" depois de ter pedido algo. |
| **Não precisa** | agradecimento ou encerramento ("obrigado", "deu certo", 👍), risadas e emojis, ou mensagens sem pergunta, pedido ou problema. |

O cartão mostra cada grupo numa linha com o motivo e a mensagem analisada. A tela cheia lista todos os grupos com os sinais encontrados. Em **Configurações › Indicadores** dá para ajustar quantos dias e quantas mensagens analisar e editar as listas de palavras de urgência, pedido e encerramento.

## Responder pelo sistema

Ative em **Configurações › Geral › Responder pelo sistema** (somente admin). A conversa de cada grupo monitorado ganha uma caixa de resposta, e cada mensagem tem a opção **responder**, que cita a mensagem original como no WhatsApp.

- A mensagem vai para uma fila e o worker a envia pelo **número conectado**. Como o painel é um aparelho conectado ao número (igual ao WhatsApp Web), a mensagem **aparece também no celular**. O caminho contrário já existia: o que é enviado pelo celular aparece no painel.
- **Assinar com o nome** (ligado por padrão): a mensagem começa com `*Nome:*`, para o cliente saber quem respondeu. No painel e nos indicadores, a resposta conta para quem a escreveu.
- **Quem pode responder**: todos os usuários ou só administradores. A regra é conferida no banco.
- A tela mostra o andamento de cada envio: na fila, enviando, enviada ou não enviada. Se o envio falhar, há as opções **Tentar de novo** e **Descartar**. Mensagens que não saírem em 10 minutos (WhatsApp desconectado) são marcadas como não enviadas, para não chegarem atrasadas ao cliente.

## Modo TV (monitor na parede)

No **Dashboard**, clique em **Modo TV**, ou abra `https://SEU-PAINEL.vercel.app/tv` no navegador do monitor ou da TV, logado com um usuário do sistema.

- Ocupa a tela inteira, sem menu e sem rolagem, e se ajusta ao tamanho da tela (de notebook a TV 4K).
- **Topo:** situação do WhatsApp, alertas abertos, período, relógio e horário da última atualização.
- **Faixa de números:** todos os indicadores numéricos lado a lado.
- **Painéis:** todos numa tela só. A primeira linha é compacta: cada tabela ou lista mostra 5 linhas de dados e o restante fica numa rolagem que anda sozinha devagar e para quando o mouse está em cima. Os demais painéis preenchem o resto da tela, também com rolagem automática quando o conteúdo não cabe.
- Atualiza sozinho a cada mensagem, alerta ou demanda nova (tempo real) e a cada minuto. O cursor some quando o mouse fica parado.
- O botão no canto superior direito põe o navegador em tela cheia. Na TV, também dá para usar a tecla F11.
- Opções no endereço:
  - `?period=today` (ou `7d`, `30d`, `90d`): período;
  - `&group=…` e `&member=…`: os mesmos filtros do dashboard;
  - `&rotacao=20`: em vez de tudo numa tela, divide os painéis em páginas que se revezam a cada 20 segundos;
  - `&tema=claro`: tema claro.

## Relatórios

A página **Relatórios** mostra os indicadores ativos em forma de tabela, com os mesmos filtros do dashboard (período, grupo e atendente). Dá para:

- **Exportar relatório (CSV)**: um arquivo com uma seção por indicador, pronto para abrir no Excel;
- **Lista detalhada (CSV)**: as mensagens ou demandas que compõem cada indicador;
- **Imprimir / PDF**: imprime só o conteúdo da página.

Indicadores desligados não aparecem no relatório nem podem ser exportados.

## Como criar um indicador novo

1. Crie a função de cálculo `public.ind_<chave>(f jsonb, p jsonb) returns jsonb`, devolvendo um dos formatos padrão (`kpi`, `table`, `series`, `bars`, `heatmap` — veja o cabeçalho de `0008_indicators.sql`). `f` traz os filtros (`from`, `to`, `group_id`, `member_id`, `tz`, horário comercial e feriados) e `p` os parâmetros do indicador.
   Um `heatmap` pode trazer também `highlights` (frases-resumo), `by_hour`/`by_day` (totais) e `business` (expediente): o painel então mostra resumo e gráficos simples, com o mapa recolhido. Nas tabelas, cada coluna aceita `format` (`number`, `duration`, `percent`, `percent_delta`, `datetime`, `text` ou `spark`, uma lista de números desenhada como mini gráfico), `bar`, `highlight_abs_gte` e `warn_below`.
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
