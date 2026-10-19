-- =====================================================================
-- Mensagens a ignorar: frases da empresa.
--
-- Além dos agradecimentos padrão ("ok", "obrigado", 👍), cada empresa
-- cadastra as frases do cliente que não pedem resposta (ex.: "obrigado
-- pelo retorno, doutora", "fico no aguardo"). Valem com a opção "Ignorar
-- agradecimentos" ligada (Configurações › Geral › Mensagens a ignorar).
-- =====================================================================

alter table public.app_settings
  add column if not exists ignore_phrases text[] not null default '{}';
