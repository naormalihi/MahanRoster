-- Local/CI only: the minimum of Supabase that the migrations rely on.
-- On a real Supabase project these objects already exist; never run this there.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

-- Supabase reads the JWT "sub" claim from this setting.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default: API roles get table privileges; RLS is what actually protects rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Supabase exposes all JWT claims (incl. "aal") through auth.jwt().
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- Columns of auth.users / auth.identities that the user-management functions fill (as on Supabase).
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud text,
  add column if not exists role text,
  add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists raw_app_meta_data jsonb,
  add column if not exists raw_user_meta_data jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists confirmation_token text,
  add column if not exists recovery_token text,
  add column if not exists email_change_token_new text,
  add column if not exists email_change text,
  add column if not exists phone_change text,
  add column if not exists phone_change_token text,
  add column if not exists email_change_token_current text,
  add column if not exists reauthentication_token text;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider_id, provider)
);
-- the parts of Supabase Auth's MFA and session tables the app touches (reset_user_mfa)
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'verified',
  secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  aal text,
  created_at timestamptz default now()
);
create table if not exists auth.refresh_tokens (
  id bigserial primary key,
  token text,
  user_id text,
  revoked boolean default false,
  session_id uuid references auth.sessions(id) on delete cascade
);
