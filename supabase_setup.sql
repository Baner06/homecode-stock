-- ============================================================
-- HomeCode Stock — Configuración de base de datos (Supabase)
-- ------------------------------------------------------------
-- Cómo aplicarlo:
--   1. Entra a tu proyecto en https://supabase.com
--   2. Menú lateral: SQL Editor → New query
--   3. Pega TODO este archivo y pulsa RUN
--   4. (Opcional) Authentication → Providers → Email:
--      desactiva "Confirm email" si quieres que los empleados
--      puedan entrar inmediatamente sin confirmar el correo.
--
-- Roles soportados:  'empleado' | 'lider' | 'admin'
-- (el "cliente" es el usuario anónimo, no necesita cuenta)
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabla de PRODUCTOS
-- ------------------------------------------------------------
create table if not exists public.products (
  barcode    text primary key,
  sku        text,                       -- ID interno único (independiente del código de barras)
  name       text,
  pasillo    text,                       -- Pasillo (ej. "26a")
  estante    text,                       -- Estante / código de estante (ej. "7648G-01")
  zone       integer not null default 1,
  col        integer not null default 1,
  row_num    integer not null default 1, -- Fila DENTRO del estante (no confundir con el nº de estante)
  position   integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by text
);

-- Migración: si la tabla ya existía, agrega las columnas nuevas.
alter table public.products add column if not exists sku     text;
alter table public.products add column if not exists pasillo text;
alter table public.products add column if not exists estante text;

-- El SKU debe ser único (cuando está presente).
create unique index if not exists products_sku_key
  on public.products (sku) where sku is not null;

-- ------------------------------------------------------------
-- 2) EMPLEADOS AUTORIZADOS (lista blanca de documentos)
--    Cada documento interno único habilita un registro y trae
--    asignado el rol que tendrá ese empleado.
-- ------------------------------------------------------------
create table if not exists public.empleados_autorizados (
  documento  text primary key,
  nombre     text,
  rol        text not null default 'empleado'
             check (rol in ('empleado','lider','admin')),
  usado      boolean not null default false,
  creado_en  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) PERFILES (un registro por usuario autenticado)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  documento  text,
  nombre     text,
  email      text,
  rol        text not null default 'empleado'
             check (rol in ('empleado','lider','admin')),
  creado_en  timestamptz not null default now()
);

-- ============================================================
-- FUNCIONES DE AYUDA (rol del usuario actual)
-- SECURITY DEFINER = evitan recursión de RLS al leer profiles
-- ============================================================
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public
as $$ select rol from public.profiles where id = auth.uid() $$;

create or replace function public.es_empleado()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.mi_rol() in ('empleado','lider','admin'), false) $$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.mi_rol() = 'admin', false) $$;

-- ============================================================
-- VERIFICAR DOCUMENTO (usado por el formulario de registro)
-- Devuelve el rol asignado, o NULL si el documento no existe
-- o ya fue usado. No expone la tabla completa al cliente.
-- ============================================================
create or replace function public.verificar_documento(p_doc text)
returns text language sql stable security definer set search_path = public
as $$
  select rol from public.empleados_autorizados
  where documento = p_doc and usado = false
$$;
grant execute on function public.verificar_documento(text) to anon, authenticated;

-- ============================================================
-- TRIGGER: al crear un usuario nuevo, crea su perfil con el
-- rol que corresponde al documento que envió en el registro.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_doc text;
  v_rol text;
  v_nom text;
begin
  v_doc := nullif(new.raw_user_meta_data->>'documento', '');
  v_nom := nullif(new.raw_user_meta_data->>'nombre', '');

  if v_doc is not null then
    select rol, coalesce(v_nom, nombre) into v_rol, v_nom
    from public.empleados_autorizados
    where documento = v_doc and usado = false
    limit 1;
  end if;

  if v_rol is not null then
    insert into public.profiles (id, documento, nombre, email, rol)
    values (new.id, v_doc, coalesce(v_nom, new.email), new.email, v_rol)
    on conflict (id) do update
      set documento = excluded.documento,
          nombre    = excluded.nombre,
          rol       = excluded.rol;

    update public.empleados_autorizados set usado = true where documento = v_doc;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.products             enable row level security;
alter table public.profiles             enable row level security;
alter table public.empleados_autorizados enable row level security;

-- ---- PRODUCTS ----
-- Buscar/leer: todos (incluido el cliente anónimo)
drop policy if exists products_select_all on public.products;
create policy products_select_all on public.products
  for select using (true);

-- Registrar (insert): empleado, líder o admin
drop policy if exists products_insert_empleado on public.products;
create policy products_insert_empleado on public.products
  for insert with check (public.es_empleado());

-- Editar (update): empleado, líder o admin
drop policy if exists products_update_empleado on public.products;
create policy products_update_empleado on public.products
  for update using (public.es_empleado()) with check (public.es_empleado());

-- Eliminar (delete): SOLO admin
drop policy if exists products_delete_admin on public.products;
create policy products_delete_admin on public.products
  for delete using (public.es_admin());

-- ---- PROFILES ----
-- Cada quien ve su propio perfil; el admin ve todos
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.es_admin());

-- Solo el admin puede cambiar roles desde la app
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.es_admin()) with check (public.es_admin());

-- ---- EMPLEADOS_AUTORIZADOS ----
-- Solo el admin gestiona la lista blanca (el registro usa la
-- función verificar_documento, que es SECURITY DEFINER).
drop policy if exists autorizados_admin_all on public.empleados_autorizados;
create policy autorizados_admin_all on public.empleados_autorizados
  for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================
-- DATOS INICIALES Y DE PRUEBA
-- ============================================================
-- Carga aquí los documentos internos de tus empleados con su rol:
insert into public.empleados_autorizados (documento, nombre, rol) values
  ('1001', 'Administrador General', 'admin'),
  ('1004', 'Soporte Técnico Admin', 'admin'),     -- Usuario de prueba (Admin)
  
  ('1002', 'Líder Zona A',          'lider'),
  ('1005', 'Supervisor Turno B',    'lider'),     -- Usuario de prueba (Líder)
  
  ('1003', 'Empleado Bodega',       'empleado'),
  ('1006', 'Auxiliar Inventario',   'empleado')   -- Usuario de prueba (Empleado)
on conflict (documento) do nothing;

-- Si YA creaste el usuario admin (admincode@hcs.com) en
-- Authentication → Users, esto asegura su perfil como 'admin'.
-- (Cambia el correo si usas otro.)
insert into public.profiles (id, email, nombre, rol)
select id, email, 'Administrador', 'admin'
from auth.users
where email = 'admincode@hcs.com'
on conflict (id) do update set rol = 'admin';