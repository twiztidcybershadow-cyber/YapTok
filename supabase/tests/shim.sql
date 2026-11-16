-- shim.sql
-- What a Supabase project already has before the first migration runs, for a
-- plain local PostgreSQL: the three API roles, the auth schema with
-- auth.users, auth.uid(), and the default privileges Supabase sets on the
-- public schema. Only for the local tests and the local dev stack
-- (scripts/db-test.mjs, scripts/local-stack.mjs). Never run it on Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  -- Only the local dev stack signs in with this (scrypt, see local-stack.mjs).
  password_hash text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The signed in person's id, from the JWT claims the API puts in the session.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase lets the API roles use everything in public unless a migration
-- takes it away, so the migrations' own revokes are what the tests check.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
