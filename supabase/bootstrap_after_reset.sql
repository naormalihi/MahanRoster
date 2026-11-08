-- After reset_all.sql and a db-migrate run: give the logins that were kept back their
-- נע"ת role. Run in Supabase › SQL Editor.
insert into app_users (id, username, must_change_password, privacy_ack_at)
select id, split_part(email, '@', 1), false, now() from auth.users
on conflict (id) do nothing;

insert into user_roles (user_id, role)
select id, 'coordinator' from app_users u
where not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'coordinator');

select u.username, r.role from app_users u join user_roles r on r.user_id = u.id;
