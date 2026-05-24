-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v2 — Esquema limpio con JSONB
-- Corre esto en: Supabase → SQL Editor
-- Seguro: las tablas de datos están vacías (solo auth.users tiene datos)
-- ═══════════════════════════════════════════════════════════════

-- 1. Borrar tablas anteriores (cascade borra dependencias y políticas)
drop table if exists permisos      cascade;
drop table if exists staff         cascade;
drop table if exists config_negocio cascade;
drop table if exists inventarios   cascade;
drop table if exists recetas       cascade;
drop table if exists insumos       cascade;
drop table if exists negocios      cascade;
drop table if exists usuarios      cascade;

-- 2. Tabla usuarios (espejo de auth.users con nombre y plan)
create table usuarios (
    id         uuid primary key references auth.users(id) on delete cascade,
    nombre     text,
    plan       text default 'micro',
    created_at timestamptz default now()
);
alter table usuarios enable row level security;
create policy "own" on usuarios
    for all using (auth.uid() = id)
    with check (auth.uid() = id);

-- 3. Negocios
create table negocios (
    id         text primary key,
    usuario_id uuid references auth.users(id) on delete cascade not null,
    datos      jsonb not null default '{}',
    created_at timestamptz default now()
);
alter table negocios enable row level security;
create policy "own" on negocios
    for all using (auth.uid() = usuario_id)
    with check (auth.uid() = usuario_id);

-- 4. Staff
create table staff (
    id         text primary key,
    negocio_id text references negocios(id) on delete cascade not null,
    datos      jsonb not null default '{}',
    created_at timestamptz default now()
);
alter table staff enable row level security;
create policy "own" on staff
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 5. Config negocio
create table config_negocio (
    negocio_id text primary key references negocios(id) on delete cascade,
    datos      jsonb not null default '{}',
    updated_at timestamptz default now()
);
alter table config_negocio enable row level security;
create policy "own" on config_negocio
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 6. Permisos por rol
create table permisos (
    negocio_id text references negocios(id) on delete cascade not null,
    rol        text not null,
    datos      jsonb not null default '{}',
    primary key (negocio_id, rol)
);
alter table permisos enable row level security;
create policy "own" on permisos
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 7. Insumos (estructura para migración futura)
create table insumos (
    negocio_id text primary key references negocios(id) on delete cascade,
    datos      jsonb not null default '{}',
    updated_at timestamptz default now()
);
alter table insumos enable row level security;
create policy "own" on insumos
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 8. Recetas
create table recetas (
    negocio_id text primary key references negocios(id) on delete cascade,
    datos      jsonb not null default '{}',
    updated_at timestamptz default now()
);
alter table recetas enable row level security;
create policy "own" on recetas
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 9. Inventarios
create table inventarios (
    negocio_id text primary key references negocios(id) on delete cascade,
    datos      jsonb not null default '{}',
    updated_at timestamptz default now()
);
alter table inventarios enable row level security;
create policy "own" on inventarios
    for all using (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    )
    with check (
        exists (select 1 from negocios where id = negocio_id and usuario_id = auth.uid())
    );

-- 10. Trigger: crear fila en usuarios cuando alguien se registra
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
    insert into usuarios (id, nombre, plan)
    values (
        new.id,
        new.raw_user_meta_data->>'nombre',
        coalesce(new.raw_user_meta_data->>'plan', 'micro')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure handle_new_user();
