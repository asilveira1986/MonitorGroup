-- =====================================================================
-- CRIAR ADMINISTRADOR DA PLATAFORMA
--
-- Cria (ou promove) um usuário com permissão em todo o sistema:
--  * menu Empresas: cadastrar empresas, liberar e suspender acessos,
--    definir limites e cadastrar administradores de cada empresa;
--  * administrador em qualquer empresa em que entrar (seletor no topo);
--  * entra mesmo quando a empresa em que está foi suspensa.
--
-- Como usar: troque os 3 valores abaixo (e-mail, senha e nome) e execute
-- tudo no SQL Editor do Supabase. Pode executar de novo: se o e-mail já
-- existir, o usuário é promovido e a senha é trocada pela informada.
-- Pré-requisito: supabase/atualizar_banco.sql já executado (multiempresa).
-- =====================================================================

do $$
declare
  v_email    text := lower(trim('admin@suaempresa.com.br'));   -- << e-mail de acesso
  v_password text := 'TroqueEstaSenha123';                     -- << senha (mínimo 8 caracteres)
  v_name     text := 'Administrador da Plataforma';            -- << nome
  v_user     uuid;
  v_company  uuid;
begin
  if length(v_password) < 8 then
    raise exception 'A senha precisa de ao menos 8 caracteres';
  end if;
  if to_regclass('public.companies') is null then
    raise exception 'Execute antes o supabase/atualizar_banco.sql (multiempresa)';
  end if;

  -- empresa onde o administrador começa (a primeira cadastrada)
  select id into v_company from public.companies order by created_at, id limit 1;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    -- cria o login já confirmado (e-mail + senha)
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, v_user::text,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  else
    -- já existe: confirma o e-mail e troca a senha pela informada
    update auth.users
       set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_user;
  end if;

  -- autoriza o e-mail na empresa e garante o perfil com permissão total
  insert into public.allowed_emails (email, role, company_id)
  values (v_email, 'admin', v_company)
  on conflict (email) do update set role = 'admin';

  insert into public.profiles (id, email, full_name, role, active, company_id, platform_admin)
  values (v_user, v_email, v_name, 'admin', true, v_company, true)
  on conflict (id) do update
    set role = 'admin', active = true, platform_admin = true,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        company_id = coalesce(public.profiles.company_id, excluded.company_id);

  raise notice 'Administrador da plataforma pronto: %', v_email;
end $$;

-- conferência: deve aparecer o e-mail com "sim" nas três colunas
select p.email as "E-mail",
       case when p.platform_admin then 'sim' else 'não' end as "Administra a plataforma",
       case when p.active then 'sim' else 'não' end as "Ativo",
       case when u.email_confirmed_at is not null then 'sim' else 'não' end as "E-mail confirmado",
       c.name as "Empresa atual"
from public.profiles p
join auth.users u on u.id = p.id
left join public.companies c on c.id = p.company_id
where p.platform_admin
order by p.email;
