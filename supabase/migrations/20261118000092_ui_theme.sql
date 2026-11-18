-- The look a user chose (light / dark / as the device), kept with the account so another
-- device follows it. Each device also keeps its own copy; this one wins at sign-in.
alter table app_users add column if not exists ui_theme text check (ui_theme in ('auto', 'light', 'dark'));

create or replace function public.set_my_theme(p_theme text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_theme is not null and p_theme not in ('auto', 'light', 'dark') then
    raise exception 'unknown theme %', p_theme using errcode = '22023';
  end if;
  update app_users set ui_theme = p_theme where id = auth.uid();
end $$;
revoke execute on function public.set_my_theme(text) from public, anon;
grant execute on function public.set_my_theme(text) to authenticated;
