-- =====================================================================
-- Menus do menu lateral liberados por empresa
--
-- Em Configurações › Menus o administrador escolhe, para cada item do menu
-- lateral, quem o vê: todos os usuários, só administradores ou ninguém
-- (oculto). Menu oculto também bloqueia a página (quem abrir pelo endereço
-- volta para o primeiro menu liberado). Configurações fica sempre com os
-- administradores, para ninguém se trancar do lado de fora.
--  * app_settings.menu_access: {"/panel": "all" | "admin" | "none", ...};
--    item sem valor = todos.
-- =====================================================================

alter table public.app_settings
  add column if not exists menu_access jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
