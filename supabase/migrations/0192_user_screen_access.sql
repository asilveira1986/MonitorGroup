-- =====================================================================
-- Acesso às telas por usuário (Configurações › Pessoas).
--
-- O padrão de cada pessoa vem do perfil e dos menus da empresa (0031). O administrador pode liberar ou
-- bloquear telas só para uma pessoa: profiles.screen_access guarda só o que difere do padrão, por exemplo
-- {"/alerts": false, "/reports": true}. Nulo = vale o padrão. Quem altera é o administrador da empresa
-- (a política profiles_admin_update, 0030, já cobre a coluna nova).
-- =====================================================================

alter table public.profiles
  add column if not exists screen_access jsonb;

notify pgrst, 'reload schema';
