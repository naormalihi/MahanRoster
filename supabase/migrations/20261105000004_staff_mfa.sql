-- =============================================================================
-- Staff access requires a second factor.
--
-- נע"ת and the deputy see every soldier, so a stolen password alone must not be
-- enough: their staff rights apply only when the session passed TOTP (the JWT
-- carries aal = 'aal2'). The shared view account is not affected.
-- =============================================================================

create or replace function app.mfa_passed() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' $$;

create or replace function app.is_staff() returns boolean
language sql stable as $$
  select app.mfa_passed() and (app.has_role('coordinator') or app.has_role('deputy'))
$$;

create or replace function app.is_coordinator() returns boolean
language sql stable as $$ select app.mfa_passed() and app.has_role('coordinator') $$;

drop policy coordinator_write on app_users;
create policy coordinator_write on app_users for all to authenticated
  using (app.is_coordinator()) with check (app.is_coordinator());

drop policy coordinator_write on user_roles;
create policy coordinator_write on user_roles for all to authenticated
  using (app.is_coordinator()) with check (app.is_coordinator());

grant execute on function app.mfa_passed(), app.is_coordinator() to authenticated, service_role;
