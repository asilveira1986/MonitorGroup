# MonitorGroup – Monitor de grupos de WhatsApp

Sistema web que acompanha as mensagens recebidas e enviadas nos grupos de WhatsApp da sua empresa e garante que **nenhum cliente fique sem resposta**.

- **Conexão por QR code**: conecte o número que participa dos grupos, igual ao WhatsApp Web.
- **Fila "Aguardando resposta"**: mostra em tempo real os grupos em que um cliente escreveu e a equipe ainda não respondeu, ordenados pelo tempo de espera.
- **Dashboard**: tempo médio de primeira resposta, mediana e P90, % dentro do SLA, volume diário (clientes x equipe), distribuição dos tempos de resposta, movimento por hora, ranking dos grupos e desempenho de cada atendente.
- **Alertas configuráveis**: cliente sem resposta há X minutos, palavras-chave ("urgente", "cancelar"…), volume alto de mensagens, grupo parado e WhatsApp desconectado. Os avisos chegam no painel (em tempo real), por **e-mail**, por **WhatsApp** ou por **webhook** (Slack, Teams, n8n, Zapier…).
- **Indicadores configuráveis**: o dashboard é montado a partir de um catálogo de indicadores agrupados em blocos. Em **Configurações › Indicadores** (só administradores) é possível ligar/desligar cada indicador ou bloco, ligar/desligar o alerta, editar os parâmetros e restaurar o padrão. As mudanças valem na hora para todos e ficam registradas (quem e quando). Desligar não apaga dados.
- **Importação do histórico**: ao ler o QR code, as mensagens anteriores dos grupos monitorados (padrão: últimos 30 dias, só texto) são importadas em segundo plano e as métricas do período já aparecem no dashboard. Para um número já conectado, use **Configurações › WhatsApp › Conexão e arquivos › Importar histórico** (gera um novo QR code, pois o WhatsApp só envia o histórico na conexão). A conversa de cada grupo carrega 50 mensagens por vez ao rolar.
- **Grupos excluídos**: quando o número conectado sai ou é removido de um grupo, ou o grupo é apagado no celular, ele vai para a aba **Grupos › Excluídos**, sai da fila e dos alertas, mas o histórico continua disponível. O administrador pode excluí-lo definitivamente de lá. Se o número voltar ao grupo, ele é reativado sozinho.
- **Login** com e-mail e senha cadastrados por um administrador. Só entra quem foi autorizado.
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

**Como uma conversa é avaliada:** cada mensagem de um grupo é classificada como *cliente* ou *equipe*. Mensagens enviadas pelo número conectado e pelos atendentes cadastrados em **Configurações › Pessoas** contam como equipe. Quando um cliente escreve, o grupo entra na fila de pendências. Quando a equipe responde, a pendência fecha e o sistema registra o tempo de resposta, contado a partir da **última** mensagem do cliente antes da resposta. A fila de pendências e os alertas de "sem resposta" continuam contando a espera desde a primeira mensagem não respondida. Mensagens curtas de agradecimento ("ok", "obrigado", 👍) não abrem uma nova pendência (essa opção pode ser desligada).

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
   26. `supabase/migrations/0026_commitment_demands.sql`
   27. `supabase/migrations/0027_sectors.sql`
   28. `supabase/migrations/0028_commitment_triggers.sql`
   29. `supabase/migrations/0029_management_summary.sql`
   30. `supabase/migrations/0030_multi_company.sql`
   31. `supabase/migrations/0031_menu_access.sql`
   32. `supabase/migrations/0032_voice_alert.sql`
   33. `supabase/migrations/0033_voice_alert_rules.sql`
   34. `supabase/migrations/0034_voice_options.sql`
   35. `supabase/migrations/0035_viewer_role.sql`
   36. `supabase/migrations/0036_group_members.sql`
   37. `supabase/migrations/0037_ignore_stickers_emoji.sql`
   38. `supabase/migrations/0038_media_files.sql`
   39. `supabase/migrations/0039_group_responsible.sql`
   40. `supabase/migrations/0040_recalc_groups.sql`
   41. `supabase/migrations/0041_ignore_phrases.sql`
   42. `supabase/migrations/0042_quick_replies.sql`
   43. `supabase/migrations/0043_conversation_closing.sql`
   44. `supabase/migrations/0044_avatars.sql`
   45. `supabase/migrations/0045_avatar_full.sql`
   46. `supabase/migrations/0046_faster_keywords.sql`
   47. `supabase/migrations/0047_members_lid.sql`
   48. `supabase/migrations/0048_ignore_technical_messages.sql`
   49. `supabase/migrations/0049_files_and_team_users.sql`
   50. `supabase/migrations/0050_activity_log.sql`
   51. `supabase/migrations/0051_lid_team_messages.sql`
   52. `supabase/migrations/0052_group_mute.sql`
   53. `supabase/migrations/0053_remove_group_mute.sql`
   54. `supabase/migrations/0054_alert_type_mutes.sql`
   55. `supabase/migrations/0055_remove_alert_type_mutes.sql`
   56. `supabase/migrations/0056_group_responsibles.sql`
   57. `supabase/migrations/0057_alerts_unassigned_groups.sql`
   58. `supabase/migrations/0058_my_alerts_off.sql`
   59. `supabase/migrations/0059_demand_delivery_agenda.sql`
   60. `supabase/migrations/0060_agenda_events.sql`
   61. `supabase/migrations/0061_demand_types.sql`
   62. `supabase/migrations/0062_message_reactions.sql`
   63. `supabase/migrations/0063_demands_for_assignee.sql`
   64. `supabase/migrations/0064_block_technical_messages.sql`
   65. `supabase/migrations/0065_fix_group_write_guard.sql`
   66. `supabase/migrations/0066_edit_delete_messages.sql`
   67. `supabase/migrations/0067_delete_for_me.sql`
   68. `supabase/migrations/0068_message_receipts.sql`
   69. `supabase/migrations/0069_private_chats.sql`
   70. `supabase/migrations/0070_private_chats_tools.sql`
   71. `supabase/migrations/0071_private_chats_send_files.sql`
   72. `supabase/migrations/0072_contacts_sync.sql`
   73. `supabase/migrations/0073_contacts_names.sql`
   74. `supabase/migrations/0074_send_audio.sql`
   75. `supabase/migrations/0075_contacts_phone_match.sql`
   76. `supabase/migrations/0076_reclassify_senders.sql`
   77. `supabase/migrations/0077_lid_phone_mapping.sql`
   78. `supabase/migrations/0078_message_sender_fix.sql`
   79. `supabase/migrations/0079_members_team_names.sql`
   80. `supabase/migrations/0080_sender_from_quote.sql`
   81. `supabase/migrations/0081_unknown_senders.sql`
   82. `supabase/migrations/0082_log_message_sender.sql`
   83. `supabase/migrations/0083_logo_and_team_photo.sql`
   84. `supabase/migrations/0084_targeted_recalc.sql`
   85. `supabase/migrations/0085_my_profile.sql`
   86. `supabase/migrations/0086_members_responsible.sql`
   87. `supabase/migrations/0087_responsible_sees_groups.sql`
   88. `supabase/migrations/0088_audio_duration.sql`
   89. `supabase/migrations/0089_thanks_after_team.sql`
   90. `supabase/migrations/0090_message_quotes.sql`
   91. `supabase/migrations/0091_demand_client_notice.sql`
   92. `supabase/migrations/0092_demand_done_notice.sql`
   93. `supabase/migrations/0093_system_notices.sql`
   94. `supabase/migrations/0094_everyone_replies.sql`
   95. `supabase/migrations/0095_lock_down_public.sql`
   96. `supabase/migrations/0096_lgpd_retention_requests.sql`
   97. `supabase/migrations/0097_agenda_standalone.sql`
   98. `supabase/migrations/0098_push_notifications.sql`
   99. `supabase/migrations/0099_push_stale_events.sql`
   100. `supabase/migrations/0100_push_grants.sql`
   101. `supabase/migrations/0101_agenda_reminders.sql`
   102. `supabase/migrations/0102_agenda_types_repeat.sql`
   103. `supabase/migrations/0103_customer_tags.sql`
   104. `supabase/migrations/0104_lgpd_platform_only.sql`
   105. `supabase/migrations/0105_forward_cross_reply.sql`
   106. `supabase/migrations/0106_team_whatsapp_notices.sql`
   107. `supabase/migrations/0107_people_sectors_unified.sql`
   108. `supabase/migrations/0108_cleanup_old_data.sql`
   109. `supabase/migrations/0109_contact_directory.sql`
   110. `supabase/migrations/0110_thanks_reply_to_team.sql`
   111. `supabase/migrations/0111_reaction_answers.sql`
   112. `supabase/migrations/0112_contacts.sql`
   113. `supabase/migrations/0113_contacts_photos.sql`
   114. `supabase/migrations/0114_private_chats_per_user.sql`
   115. `supabase/migrations/0115_dashboard_speed.sql`
   116. `supabase/migrations/0116_private_sign_name.sql`
   117. `supabase/migrations/0117_masked_contact_names.sql`
   118. `supabase/migrations/0118_private_mark_unread.sql`
   119. `supabase/migrations/0119_private_chat_finish.sql`
   120. `supabase/migrations/0120_private_alert_settings.sql`
   121. `supabase/migrations/0121_instance_sector.sql`
   122. `supabase/migrations/0122_groups_follow_instance_sector.sql`
   123. `supabase/migrations/0123_first_access_password.sql`
   124. `supabase/migrations/0124_private_queue_for_all.sql`
   125. `supabase/migrations/0125_private_phone_signature_owner.sql`
   126. `supabase/migrations/0126_private_signer_accents.sql`
   127. `supabase/migrations/0127_private_signer_tolerant.sql`
   128. `supabase/migrations/0128_private_signer_all_users.sql`
   129. `supabase/migrations/0129_general_sector_sees_all.sql`
   130. `supabase/migrations/0130_private_dashboard.sql`
   131. `supabase/migrations/0131_dashboard_speed_2.sql`
   132. `supabase/migrations/0132_recalc_in_steps.sql`
3. Em **Project Settings › API**, anote:
   - `Project URL`
   - `anon public` key
   - `service_role` key (é secreta: nunca coloque no navegador nem a compartilhe)
4. Depois do passo 3 (Vercel), volte em **Authentication › URL Configuration** (usado pelo link de "Esqueci minha senha"):
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

4. Clique em **Deploy**. Depois, volte ao passo 1.4 e cadastre a URL gerada no Supabase.

### 4. Primeiro acesso

1. Crie o primeiro usuário no Supabase: abra **Authentication › Users › Add user**, informe e-mail e senha e marque *Auto confirm*.
   Ele administra a plataforma (menu **Empresas**) e a primeira empresa.

   **O primeiro usuário vira administrador automaticamente.**
2. Em **Configurações › WhatsApp › Conexão e arquivos**, clique em **Nova conexão** e leia o QR code com o celular (*Aparelhos conectados › Conectar um aparelho*).
3. Os grupos aparecem em **Grupos**. Desligue o monitoramento dos grupos que não são de clientes.
4. Em **Configurações › Pessoas**, cadastre os números dos atendentes que respondem pelo próprio celular.
5. Em **Configurações › Empresa › Dados da empresa**, ajuste o horário comercial e o SLA. Depois revise as regras em **Configurações › Regras de alerta**.
6. Em **Configurações › Pessoas**, cadastre as outras pessoas com e-mail e uma senha inicial. Cada uma pode trocar a senha em **Esqueci minha senha**, na tela de login.

## Configurações: onde fica cada coisa

| Grupo | Telas |
|---|---|
| **Empresa** | Dados da empresa (nome, logo, horário comercial, feriados) · Menus · Privacidade (LGPD, só o administrador geral) |
| **Pessoas** | **Pessoas**: um cadastro só para quem atende nos grupos e quem entra no painel · **Setores**: quem vê cada grupo e as equipes da agenda |
| **WhatsApp** | Conexão e arquivos · Respostas e mensagens · Mensagens rápidas · **Avisos automáticos** (ao cliente no grupo e à equipe no WhatsApp) |
| **Atendimento** | Demandas (tipos e como são criadas) · Agenda (tipos de compromisso) · Etiquetas |
| **Monitoramento** | Regras de alerta · Avisos em tela e voz · Indicadores |

**Pessoas** (desde a 0107): cada pessoa aparece uma vez, com duas chaves — *atende nos grupos* (as mensagens dela contam como da equipe) e *entra no painel* (login com o perfil). Nome e telefone são os mesmos nos dois e mudam também pelo *Meu perfil*. **Nova pessoa** cadastra os dois de uma vez; quem só tem um deles ganha o outro pelos botões *Dar acesso* / *+ Atende nos grupos*.

**Setores** (desde a 0107): os mesmos setores servem para os grupos e para a agenda (marcar o setor inteiro num compromisso e ver a agenda do setor). Os antigos "setores da agenda" viraram Setores; se o nome já existia, o novo fica "Nome (agenda)". Um setor sem grupos não dá acesso a grupo nenhum.

Os endereços antigos (Acessos ao painel, Atendentes, Setores da agenda, Avisos no WhatsApp) levam para as telas novas.

## Demandas

Uma demanda é um pedido do cliente acompanhado até a entrega. Ela pode nascer de quatro origens, cada uma ligada ou desligada em **Configurações › Atendimento › Demandas** (somente admin):

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
- **Compromisso da equipe** (ligado por padrão): quando alguém da equipe responde no grupo com uma frase de compromisso (*vou verificar*, *te retorno em seguida*, *vou providenciar*…, lista editável) ou informa um prazo (*até amanhã*, *até sexta*, *em 2 dias*, *prazo…*), a demanda abre sozinha:
  - **gatilhos**: *verbos de ação* (verificar, corrigir, realizar, ajustar, enviar…, lista editável) valem em qualquer forma de compromisso: *vou/vamos/irei/iremos corrigir*, *vou já te enviar*, *estou corrigindo*, *corrigirei*, *fico de corrigir*, *pode deixar que eu corrijo*. As *frases prontas* (*te retorno*, *dar uma olhada*, *deixa comigo*…) valem como estão. Negação logo antes (*não vou conseguir verificar*) não abre demanda. Em **Configurações › Atendimento › Demandas** há um campo para testar uma frase, e o histórico da demanda mostra o gatilho que a abriu;
  - **descrição**: o pedido do cliente que foi respondido (a mensagem citada, se a equipe respondeu citando; senão, a mensagem do cliente que essa resposta atendeu);
  - **responsável**: quem respondeu (atendente cadastrado em Equipe); **prazo**: o informado na frase, se houver; **tipo**: pelas categorias de *Tipo de demanda*;
  - se o pedido já é uma demanda, ou se a equipe volta a falar sem pedido novo do cliente (ex.: "vou verificar" e, depois, "te envio até amanhã"), a demanda existente passa para *em andamento* e recebe o prazo, sem duplicar.
- **IA** (desligada por padrão): o Claude classifica mensagens pendentes dos clientes. Requer `ANTHROPIC_API_KEY` no worker. Mensagens que o modelo recusar são tratadas como não-demanda.

O worker também detecta sozinho: prazo prometido pela equipe ("até amanhã", "em 2 dias"), cobranças do cliente, reabertura e confirmação após a entrega. As palavras usadas ficam nos parâmetros dos indicadores *Retrabalho* e *Confirmação do cliente*.

## Multiempresa (vender para outras empresas)

O sistema atende várias empresas com uma só instalação (um banco, um painel e um worker). Cada empresa fica **isolada**: grupos, mensagens, conexões do WhatsApp, alertas e regras, demandas, equipe, setores, usuários, feriados, configurações e indicadores pertencem a ela, e as regras do banco (RLS) não deixam uma empresa ver nada da outra.

- **Quem administra a plataforma** (você) vê o item **Empresas** no menu. Lá você:
  - **cadastra a empresa** com o primeiro administrador dela (e-mail e senha inicial). A empresa já nasce pronta: configurações padrão, setor **Geral** e as regras de alerta padrão (sem destinatários);
  - **libera ou suspende o acesso**: empresa suspensa não entra no painel (a tela avisa *"Acesso da empresa suspenso"*) e o WhatsApp dela é desconectado, sem apagar a sessão nem os dados. Ao liberar de novo, o worker reconecta;
  - define **limites** de grupos monitorados e de usuários (em branco = sem limite);
  - acompanha o uso: usuários, grupos monitorados, WhatsApp conectado e mensagens dos últimos 30 dias;
  - clica em **Entrar na empresa** (ou usa o seletor no topo do painel) para configurar ou dar suporte vendo exatamente o que a empresa vê.
- **Cada empresa** conecta o próprio número em **Configurações › WhatsApp › Conexão e arquivos**, cadastra os próprios usuários em **Configurações › Pessoas** e ajusta tudo nas suas configurações, sem afetar as outras. Os alertas por WhatsApp saem pelo número da própria empresa. As demandas são numeradas por empresa (#1, #2…).
- **Um e-mail pertence a uma empresa só.**
- **Criar um administrador da plataforma** (acesso total: menu Empresas, cadastro de empresas e usuários, liberação de acessos e administrador em qualquer empresa): abra `supabase/criar_admin_plataforma.sql`, troque o e-mail, a senha e o nome no início e execute no SQL Editor do Supabase. Pode executar de novo para promover um usuário que já existe ou trocar a senha dele.
- **Ao atualizar para esta versão**, os dados atuais viram a primeira empresa (com o nome de *Configurações › Empresa › Dados da empresa*) e os administradores atuais passam a administrar a plataforma.

## Perfis de usuário

Em **Configurações › Pessoas**, cada pessoa tem um perfil (dá para trocar na lista):

| Perfil | O que faz |
|---|---|
| **Administrador** | Acesso total à empresa: configurações, usuários, regras e todos os grupos. |
| **Atendente** | Atende os grupos dos seus setores: responde, cria demandas e trata alertas, conforme as permissões do setor. |
| **Somente ver painéis** | Só acompanha: vê o **Dashboard**, o **Painel de grupos** e a conversa dos grupos dos seus setores, sem alterar nada (não responde, não cria demandas, não trata alertas, não mexe em grupos nem configurações). Bom para gestores e TVs. A regra vale no banco: qualquer alteração desse perfil é recusada. |

Como os atendentes, quem só vê painéis enxerga os grupos dos setores em que está (*Configurações › Setores*).

## Menus do menu lateral

Em **Configurações › Menus** (administradores) você escolhe, para cada item do menu lateral, quem o vê: **Todos**, **Só administradores** ou **Oculto**. Vale para todos os usuários da empresa (cada empresa tem a sua configuração). Menu oculto também bloqueia a página: quem abrir pelo endereço volta para o primeiro menu liberado. **Configurações** nunca some para administradores, para ninguém ficar trancado do lado de fora. As demandas desligadas em *Configurações › Empresa › Dados da empresa* continuam saindo do menu sozinhas.

## Identidade visual

O painel segue a identidade **Monitor Group**: símbolo do balão com o pulso em "M" e o ponto de alerta, verde-limão *Sinal* (`#C6F432`) como cor da marca e do botão principal, menu lateral na superfície escura da marca (`#0E1726`), **Sora** nos títulos, **DM Sans** na interface e **JetBrains Mono** nos números e horários. As cores ficam em tokens em `web/src/app/globals.css` (tema claro e escuro); o logo, em `web/src/components/logo.tsx`; o ícone do app, em `web/src/app/icon.svg`.

## Dashboard: visão da gestão

O topo do **Dashboard** traz os totalizadores para a gestão acompanhar o andamento, de forma visual (anel do SLA com a meta, fluxo de mensagens recebidas x respostas, cartões coloridos da situação agora, barras de demandas e de fechamento das conversas), respeitando os filtros de período, grupo e atendente (e o setor de quem acessa):

| Cartão | Números |
|---|---|
| **Atendimento** (período) | mensagens recebidas, respostas da equipe, tempo médio de 1ª resposta, % dentro do SLA |
| **Situação agora** (tempo real) | grupos aguardando resposta, grupos com SLA estourado, alertas abertos (e críticos), conexão do WhatsApp |
| **Demandas** | em aberto agora (e vencidas), novas e entregues no período (com tempo médio), % de prazos cumpridos |
| **Conversas e grupos** (período) | conversas iniciadas, % fechadas, grupos ativos de monitorados, grupos silenciosos |

Cada número mostra a variação em relação a ontem (ou ao período anterior), em verde quando melhorou e em vermelho quando piorou. Clicar no número abre a tela correspondente (Aguardando resposta, Painel de grupos, Alertas, Demandas). Os indicadores completos continuam logo abaixo, em **Análises detalhadas** (clique em *Mostrar*; a escolha fica guardada no navegador).

## Painel de grupos

Menu **Painel de grupos**: cada grupo monitorado num cartão compacto, com o nome do grupo, o **tempo** (atrasado: *atraso* além do SLA; aguardando: *espera* desde a mensagem do cliente; demais: *há* quanto tempo foi a última mensagem do grupo), quantas mensagens de clientes chegaram hoje e, se houver, quantas estão sem resposta. Os tempos se atualizam sozinhos. Clicar no cartão abre o grupo. A cor mostra a situação:

| Cor | Situação |
|---|---|
| **Vermelho** | mensagem sem resposta e o tempo de resposta (SLA do grupo ou o padrão) já foi excedido |
| **Amarelo** | mensagem sem resposta, ainda dentro do tempo de resposta |
| **Verde** | teve mensagem de cliente hoje e tudo foi respondido |
| **Neutro** | nenhuma mensagem de cliente hoje |

Nos grupos sem mensagem de cliente hoje (neutros), o cartão mostra **há quantos dias foi a última mensagem** ("13 dias sem mensagens"; menos de um dia: "última mensagem há 5h"; nunca teve: "sem mensagens ainda"), em destaque âmbar a partir de 3 dias.

O SLA segue a mesma regra dos indicadores (tempo útil, se essa opção estiver ligada). Os atrasados aparecem primeiro; dá para filtrar por situação e por **setor** e buscar pelo nome. O filtro de setor abre no setor **Geral** (quando ele existe entre os setores que o usuário vê) e mostra também "Todos os setores" e, para administradores, "Sem setor". O painel se atualiza sozinho a cada mensagem nova e a cada minuto, então um cartão amarelo vira vermelho assim que o tempo de resposta estoura. Mensagens curtas só de agradecimento ou confirmação ("Recebi, obrigado!", "show, valeu 👍") não deixam o grupo aguardando resposta.

## Alertas em tela

Com o painel aberto, os avisos sobem no **canto inferior direito da tela**, sem bloquear o que você está fazendo, todos no mesmo formato (borda pulsando, ícone balançando, bipe e título da aba piscando), com o grupo e a mensagem e os botões **Abrir grupo** e **Fechar** (ou Esc):

| Aviso | Cor | Quando |
|---|---|---|
| **Nova mensagem** | verde | um cliente escreveu num grupo monitorado |
| **SLA excedido** | vermelho | a mensagem do cliente passou do tempo de resposta (SLA do grupo ou o padrão, em tempo útil se essa opção estiver ligada); mostra quem enviou, a mensagem e há quanto tempo espera |
| **Alertas do sistema** | pela gravidade (vermelho, amarelo ou azul) | o sistema criou um alerta: cliente sem resposta, palavra-chave, WhatsApp desconectado, grupo sem movimentação, prazo vencido, retrabalho, reincidência… |
| **Mensagem no privado** | verde | um cliente escreveu numa conversa privada (só para quem usa as conversas privadas; não aparece se a conversa já está aberta na tela). **Abrir conversa** leva direto a ela |

Um aviso por vez; o mesmo grupo/assunto atualiza o aviso anterior ("cliente sem resposta" e "SLA excedido" do mesmo grupo viram um aviso só). O SLA é conferido a cada 30 segundos e avisa na virada; pendências que já estavam vencidas quando a tela foi aberta não abrem aviso (continuam no Painel de grupos e em Aguardando resposta). Mensagens da equipe e a importação do histórico não geram aviso.

A configuração fica em **Configurações › Monitoramento › Avisos em tela e voz** (só administradores alteram; vale para todos):

- **Mostrar o alerta de nova mensagem** (ligado/desligado);
- **Abrir também os alertas (SLA excedido e alertas do sistema)**; desligado, os alertas do sistema aparecem só como um aviso pequeno no canto;
- **Tempo na tela**: *deixar na tela até fechar* ou *fechar sozinho* depois de 5 s, 10 s, 15 s, 30 s, 1, 2 ou 5 minutos (com contagem, que pausa com o mouse sobre o aviso);
- **Tocar som** (o navegador só libera o som depois do primeiro clique na página);
- **Testar alerta** mostra um aviso de exemplo com a configuração salva.

O sino no topo da tela silencia todos os avisos em tela só no navegador em uso.

**Aviso por voz** e **avisos em tela** ficam em *Configurações › Monitoramento › Avisos em tela e voz* (as regras ficam em *Regras de alerta*). No aviso por voz você:
- liga ou desliga a voz, e escolhe falar ou não as mensagens novas e o SLA excedido (cada regra de alerta liga ou desliga a própria voz em *Editar regra*);
- escolhe **o que cada aviso fala**: uma frase com itens clicáveis (nome do grupo, quem enviou, texto da mensagem, tempo esperando, SLA, tipo e gravidade do alerta…), com exemplo e botão **Ouvir**. Item sem valor (ex.: alerta sem grupo) sai da frase junto com a ligação ("no grupo …");
- escolhe a **voz** (as instaladas no computador e no navegador; se não existir em outro computador, ele usa a voz em português padrão dele), a **velocidade** e o **tom**.
**Sons dos avisos:** com a voz falando, toca um bipe curto antes da fala. Sem voz (desligada, ou o aviso/regra sem voz), cada tipo de aviso tem um som próprio: **mensagem recebida** (plim-plim suave), **informativo** (uma nota leve), **atenção** (dois bipes médios) e **crítico** (alarme curto com três bipes agudos, duas vezes; o SLA excedido usa este). Dá para ouvir cada um em *Regras de alerta › Avisos em tela › Tocar som*.
O sino do topo silencia também a voz naquele navegador.

## Agenda

Cada usuário tem a sua agenda (dia, semana ou mês) com os compromissos em que participa e as demandas para entregar. No **Novo compromisso**:
- **Tipo**: Reunião, Audiência, Prazo, Ligação, Visita, Pessoal... cada um com uma **cor**, que pinta o compromisso na agenda. Os tipos e as cores ficam em *Configurações › Atendimento › Agenda* (administradores).
- **Repetir**: todos os dias, todas as semanas (nos dias escolhidos), todos os meses ou todos os anos, a cada N; termina nunca, numa data ou depois de N vezes. Cada repetição é um compromisso (com os próprios lembretes e o próprio "concluir"); sem fim, a agenda fica sempre com 12 meses à frente. Editar ou excluir uma repetição pergunta: **só este** ou **este e os próximos**.
- **Lembretes**: um ou mais, com o tempo antes (notificação no celular).
- **Participantes**: pessoas ou setores inteiros (*Configurações › Pessoas › Setores*).

Tocar num compromisso (ou na notificação dele) abre os detalhes: horário, tipo, repetição, observação, participantes, lembretes, com concluir, editar e excluir.

## Notificações no celular e no computador (push)

Os avisos chegam no aparelho **mesmo com o sistema fechado** e o celular bloqueado; tocar na notificação abre a tela certa (o grupo, Demandas, Agenda ou a conversa privada).

**Como ativar (cada pessoa, em cada aparelho):** menu lateral › seu nome (**Meu perfil**) › **Notificações neste aparelho** › **Ativar** e permitir. Chega uma notificação de teste; o botão **Testar** manda outra.
- **iPhone/iPad** (iOS 16.4 ou mais novo): abra o sistema no **Safari**, toque em **Compartilhar › Adicionar à Tela de Início** e entre pelo ícone criado; só assim o iPhone libera as notificações. O sistema abre em tela cheia, como um app.
- **Android**: funciona no Chrome direto ou pelo atalho na tela inicial (menu ⋮ › *Instalar app* / *Adicionar à tela inicial*).
- **Computador**: Chrome, Edge, Firefox e Safari.

**O que avisa** (cada pessoa liga/desliga cada tipo no próprio perfil):
| Aviso | Quem recebe |
|---|---|
| **Alertas dos grupos** (cliente sem resposta, palavra crítica, WhatsApp desconectado...) | quem vê o grupo (as regras de setor e responsável); sem grupo, os administradores. Regras com "mostrar no painel" desligado não avisam |
| **Demanda nova para você**, **vence na próxima hora** e **atrasou** | os usuários ligados ao responsável da demanda (pelo e-mail da equipe) |
| **Agenda**: quando alguém te inclui num compromisso e nos **lembretes** escolhidos no compromisso (um ou mais: na hora, 5/10/15/30 min, 1/2/3 h, 1/2 dias ou 1 semana antes; dia todo: a partir das 8h do dia). Tocar abre o compromisso com os detalhes | os participantes |
| **Mensagem nova nas conversas privadas** | quem usa as conversas privadas |

Quem fez a ação não recebe aviso dela. As chaves de envio são geradas na primeira ativação (pelo painel ou pelo worker; nada a configurar). Quem envia é o worker: com ele fora do ar, os avisos esperam na fila, e os com mais de 30 minutos não são enviados quando ele volta. O envio é gratuito (serviços de push da Apple, Google e Mozilla). O conteúdo vai criptografado até o aparelho e aparece na tela bloqueada: título do aviso, grupo e o começo da mensagem. Aparelho que saiu (app removido, permissão retirada) é apagado sozinho no próximo envio.

## Acompanhamento do dia a dia

O dashboard abre em **Hoje** e foi pensado para acompanhar o dia de perto:

- **Períodos**: **Hoje**, **Ontem**, 7, 30 e 90 dias. Um dia específico pode ser aberto pelo endereço (`?period=day&date=AAAA-MM-DD`).
- **Comparação**: cada número mostra a variação em relação a **ontem até esta mesma hora** (num dia passado, ao dia anterior inteiro; nos períodos de vários dias, ao período anterior do mesmo tamanho). Ex.: "▲ 12 (+30%) vs ontem até esta hora · era 40". Números de "agora", como pendências, não mostram comparação.
- **Bloco Acompanhamento do dia**, no topo:
  - **O dia hora a hora**: mensagens recebidas, respostas da equipe e pendentes no fim de cada hora (em períodos de vários dias, um ponto por dia), com o horário de pico.
  - **Tempo de resposta hora a hora**: tempo médio e pior tempo em cada hora, para ver quando o atendimento fica lento.
  - Nos dois gráficos, o seletor no canto do cartão alterna entre **linhas** e **barras**; a escolha fica salva no navegador e vale também na tela cheia.

Os gráficos de linhas e barras mostram o **valor de cada ponto/barra** (rótulos de dados). Valores zerados ficam sem rótulo; com várias séries, cada série tem os rótulos na sua cor e numa altura própria; em períodos com mais de 31 pontos (90 dias, por exemplo) os rótulos ficam ocultos para não poluir, e o valor aparece ao passar o mouse.
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

## Setores e permissões de acesso

Em **Configurações › Pessoas › Setores** (somente admin) você cria um setor só pelo nome e, em **Editar**, marca as **Pessoas** e os **Grupos** dele (abas na mesma janela). O que o setor pode fazer (gerenciar demandas, tratar alertas) fica em *Mais opções*. Embaixo da lista, o setor que recebe os grupos novos.

- **Cada grupo pertence a um setor só.** Marcar um grupo num setor tira ele do setor anterior. O setor também pode ser trocado na página do grupo.
- **Quem é do setor vê os grupos do setor**: lista de grupos, painel, conversas, dashboard, indicadores, alertas e demandas mostram só esses grupos. Um usuário pode estar em mais de um setor.
- **Permissões por setor**: *Responder pelo sistema*, *Gerenciar demandas* e *Tratar alertas*. Ver os grupos e as conversas é a base de todo setor. As regras são conferidas no banco (RLS), não só na tela.
- **Administradores veem e fazem tudo.** Grupos sem setor e usuários sem setor ficam visíveis só para administradores.
- **Grupos novos** entram no setor escolhido em *Setor dos grupos novos*. Com "Nenhum", só administradores veem até alguém definir.
- **Na primeira atualização** é criado o setor **Geral** com todos os grupos e usuários, para nada mudar até você organizar os setores.

## Etiquetas de clientes

Marque os clientes com etiquetas coloridas (VIP, Inadimplente, Novo cliente...), **nos grupos e nas conversas privadas**:
- **No grupo**: no topo da tela do grupo, **+ Etiqueta** abre a lista para marcar/desmarcar; digite um nome novo para criar na hora (com a cor). Quem vê o grupo e não é só de ver painéis etiqueta.
- **No privado**: no topo da conversa, do mesmo jeito.
- As etiquetas aparecem na lista de **Grupos** (com filtro por etiqueta acima da lista) e na lista das **Conversas privadas** (com o filtro "Todas as etiquetas").
- Em *Configurações › Etiquetas* (administradores): renomear, trocar a cor, excluir (sai de todos) e ver quantos clientes têm cada uma.

## Membros do grupo

Na tela de cada grupo, o cartão **Membros** lista quem está no grupo (a lista do próprio WhatsApp): nome, telefone, **criador** e **admins** do grupo, quem é da **Equipe** e a atividade de cada um (mensagens nos últimos 30 dias e a última mensagem). Dá para buscar por nome ou telefone, e o "N participantes" do topo leva direto à lista. O worker atualiza os membros ao sincronizar os grupos e sempre que alguém entra, sai ou vira admin; quem sai fica no histórico. O nome vem da equipe cadastrada, do WhatsApp ou das mensagens da pessoa; sem nenhum deles, aparece o telefone.

## Responder pelo sistema

Ative em **Configurações › WhatsApp › Respostas e mensagens** (somente admin). A conversa de cada grupo monitorado ganha uma caixa de resposta, e cada mensagem tem a opção **responder**, que cita a mensagem original como no WhatsApp.

- A mensagem vai para uma fila e o worker a envia pelo **número conectado**. Como o painel é um aparelho conectado ao número (igual ao WhatsApp Web), a mensagem **aparece também no celular**. O caminho contrário já existia: o que é enviado pelo celular aparece no painel.
- **Assinar com o nome** (ligado por padrão): a mensagem começa com `*Nome:*`, para o cliente saber quem respondeu. No painel e nos indicadores, a resposta conta para quem a escreveu.
- **Quem pode responder**: todos os usuários ou só administradores. A regra é conferida no banco.
- A tela mostra o andamento de cada envio: na fila, enviando, enviada ou não enviada. Se o envio falhar, há as opções **Tentar de novo** e **Descartar**. Mensagens que não saírem em 10 minutos (WhatsApp desconectado) são marcadas como não enviadas, para não chegarem atrasadas ao cliente.

## Avisos no WhatsApp da equipe

Em *Configurações › WhatsApp › Avisos automáticos* (administradores ligam/desligam e editam o texto, com variáveis e prévia):
- **Novo compromisso**: quem foi incluído num compromisso recebe o aviso no WhatsApp dele (com dia, hora, observação e quem marcou; `{link}` abre o compromisso no painel).
- **Lembretes dos compromissos**: nos lembretes escolhidos em cada compromisso, o lembrete vai também pelo WhatsApp de cada participante.
- **Nova demanda**: o responsável recebe o aviso no WhatsApp ao ganhar uma demanda (número, descrição, grupo e prazo).

Saem pelo WhatsApp conectado da empresa para o telefone em *Meu perfil* (ou, sem ele, o do cadastro em *Atendentes*). Começam desligados. Quem fez a ação não recebe o próprio aviso; aviso parado por mais de 30 minutos (WhatsApp desconectado) não sai.

## Lista de contatos (Nova conversa no privado)

A lista mostra **todos** os contatos, uma linha por pessoa, com busca por nome ou número:
- os da **agenda do WhatsApp conectado** (nome salvo e número; marca *agenda*);
- quem já tem **conversa** no sistema, inclusive números digitados aqui (marca *conversa*);
- as pessoas da **equipe** com WhatsApp cadastrado (marca *equipe*).

A mesma pessoa que vem pelo número e pelo identificador interno do WhatsApp (LID) aparece uma vez, com o nome salvo; o número de quem só veio pelo LID é descoberto pelo mapeamento do WhatsApp conectado. Para trazer a agenda inteira de novo, use **Sincronizar contatos** no topo das Conversas privadas. A lista mostra 200 por vez (*Mostrar mais*).

## Encaminhar e responder entre o grupo e o privado

- **Encaminhar** (ícone ↪ na mensagem do grupo; menu ⋮ › *Encaminhar* no privado): manda a mensagem para outro grupo ou para uma conversa privada, com busca. Vai texto, imagem, vídeo, áudio ou documento (o arquivo precisa estar guardado no sistema) e chega como **Encaminhada** no WhatsApp; no painel também aparece "Encaminhada".
- **Responder no privado** (botão *privado* na mensagem de um cliente no grupo): escreve a resposta e ela vai para a conversa privada com essa pessoa, **citando a mensagem do grupo** (como o "Responder em particular" do WhatsApp). A conversa é criada se ainda não existir.
- **Responder num grupo** (menu ⋮ da mensagem no privado): escolhe o grupo e a resposta sai lá citando a mensagem da conversa privada.
- Valem as regras de sempre: as conversas privadas só para quem pode usá-las; nos grupos, as de *Responder pelo sistema* (ligado, grupo monitorado, quem pode responder).

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
| *Acesso não liberado* | O e-mail não está autorizado; um administrador precisa cadastrá-lo em **Configurações › Pessoas**. |
| O link de "Esqueci minha senha" volta para o login | Configure **Site URL** e **Redirect URLs** em **Authentication › URL Configuration**. |

Criou o usuário antes de rodar os scripts? Basta executar o `0004`: ele cria os perfis que faltam e torna administrador o usuário mais antigo.

## Atualizar o banco depois de uma nova versão

Em vez de rodar os scripts um a um, execute no SQL Editor do Supabase o arquivo **`supabase/atualizar_banco.sql`**. O SQL Editor corta o texto colado perto de 1 MB (aparece `syntax error at end of input`): por isso o mesmo conteúdo também vem dividido em **`supabase/atualizar_banco_parte1.sql`**, **`parte2`**…, para executar na ordem, uma depois da outra. Ele junta todos os scripts a partir do 0002, na ordem certa, e pode ser executado quantas vezes quiser: o que já existe é mantido e o que falta é criado. Erros como `function public.business_seconds(...) does not exist` acontecem quando um script é rodado antes de outro anterior; o arquivo único evita isso.

> O banco guarda quais scripts já foram aplicados (tabela `schema_migrations`): a cada execução só rodam os que faltam, então as tabelas quase não são travadas. Se mesmo assim alguma estiver ocupada pelo worker ou pelo painel (`deadlock detected` ou trava demorada), aquela parte espera e é repetida sozinha, até 5 vezes. Se ainda falhar, o que já foi gravado fica e basta executar de novo.

Ao terminar, o SQL Editor mostra uma tabela de conferência: todas as linhas com **OK** significam banco atualizado. A mensagem "Success. No rows returned" em scripts isolados também indica sucesso (scripts que criam tabelas não devolvem linhas). Para só conferir, sem executar tudo de novo, rode `supabase/conferir_banco.sql`.

Quem altera os scripts gera os arquivos de novo com `sh supabase/build-updates.sh`.

## "Could not find the '...' column … in the schema cache"

Uma função nova do painel está usando campos que o banco ainda não tem: falta executar um script SQL. No SQL Editor do Supabase, execute os scripts da pasta `supabase/migrations` que ainda não rodou, **na ordem** (veja a lista no passo 1). Os scripts podem ser executados de novo sem problema. Se o erro continuar logo depois, rode `notify pgrst, 'reload schema';` no SQL Editor e aguarde alguns segundos.

## QR code não aparece

A tela **Configurações › WhatsApp › Conexão e arquivos** mostra no topo se o worker está no ar:

- **"O worker do WhatsApp está fora do ar" / "ainda não se conectou"**: o serviço no Railway não está rodando ou não alcança o banco. Confira se o deploy terminou e o log mostra `worker do MonitorGroup no ar`, se o **Root Directory** é `worker` e as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (chave *service_role*, não a anon). Após mudar variáveis, faça novo deploy.
- **Log do Railway com "não foi possível ler o banco"**: URL/chave erradas ou scripts SQL não executados.
- **Worker no ar, mas a conexão mostra "Reconectando… código 405/403"**: o WhatsApp recusou a conexão. Aguarde alguns minutos e clique em **Tentar novamente**; se persistir, faça um novo deploy do worker (ele busca a versão mais recente do WhatsApp Web ao iniciar).
- **"O WhatsApp encerrou a conexão… (código 428: Connection Terminated)"**: quase sempre há **duas cópias do worker** usando a mesma conexão. Isso acontece com mais de 1 réplica no Railway ou com o worker rodando também no seu computador com as mesmas variáveis. Também pode ser um bloqueio temporário após muitas tentativas seguidas. Para resolver:
  1. No Railway, abra o serviço do worker › **Settings › Deploy** e confira **Replicas = 1**. Se houver um segundo serviço do worker (projeto duplicado), remova-o.
  2. Pare qualquer `npm run dev`/`npm start` do worker no seu computador.
  3. Execute o script `0013_worker_lock.sql` e faça um novo deploy. A partir dele só uma cópia se conecta por vez; uma cópia extra fica aguardando e aparece como aviso nesta tela.
  4. Aguarde 10 a 15 minutos e clique em **Conectar**. Leia o QR code assim que aparecer.
  5. O worker anuncia a versão atual do WhatsApp Web (buscada em web.whatsapp.com; aparece no topo de **Configurações › WhatsApp › Conexão e arquivos**) e, se o pareamento falhar, alterna para um perfil de conexão mais simples. Se ainda assim falhar, a mensagem de erro traz um "Diagnóstico da última tentativa" (versão, perfil e em quantos segundos a conexão caiu): envie esse texto ao suporte.
- **"Não foi possível verificar o worker"**: execute o script `0005_worker_status.sql`.

## Reação da equipe conta como resposta

Quando a equipe (o número conectado ou alguém marcado como da equipe em *Pessoas*) **reage** (👍 🙏 😂…) à mensagem do cliente, o grupo deixa de aguardar resposta, desde que o cliente não tenha escrito de novo depois da mensagem que recebeu a reação; os alertas de "sem resposta" do grupo são resolvidos. Liga/desliga em *Configurações › WhatsApp › Respostas e mensagens* (começa ligado). A reação não entra no tempo de resposta.

## Limpeza automática (espaço)

Uma vez por dia o worker apaga o que fica guardado sem uso:
- **filas de envio** já resolvidas há mais de 30 dias (respostas, encaminhadas, avisos; a mensagem continua na conversa) e pedidos de editar/apagar/reagir já feitos;
- **confirmações de entrega/leitura** de mensagens com mais de 60 dias (os tiques só importam nas recentes);
- **log de atividades** com mais de 1 ano (o de LGPD fica);
- **arquivos sem uso** no Storage há mais de 3 dias: áudio gravado que já foi enviado (o WhatsApp devolve a própria cópia), foto ou logo trocados, envio abandonado. Nada que uma mensagem, foto, logo ou fila ainda use é apagado.

Além disso continuam o prazo dos arquivos das mensagens (*WhatsApp › Conexão e arquivos*) e o prazo de guarda das mensagens (*Privacidade (LGPD)*). No banco, o espaço liberado é reaproveitado pelas próximas gravações (o Postgres não "encolhe" o arquivo na hora).

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
- O acesso é só por e-mail e senha. Um usuário desativado vê a tela *"Acesso não liberado"* e não consegue ler nenhum dado.
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
