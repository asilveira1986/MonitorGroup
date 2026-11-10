-- =====================================================================
-- A chave "Administradores são responsáveis por todos os grupos" (0162)
-- passa a vir DESLIGADA.
--
-- Ligada, ela muda quem é marcado nas cobranças da automação (os
-- administradores entram junto dos responsáveis do grupo) e o que o filtro de
-- responsável do Painel de grupos mostra. Não era o que se queria: o pedido era
-- que o Painel de grupos dos administradores abra com o setor "Todos" (isso não
-- depende desta chave). Quem quiser a regra liga em Configurações › Geral.
-- =====================================================================

alter table public.app_settings alter column admins_responsible_all set default false;
update public.app_settings set admins_responsible_all = false where admins_responsible_all;
