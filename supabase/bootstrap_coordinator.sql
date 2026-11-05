-- One-time: make the first נע"ת after creating the Auth user in the dashboard
-- (Authentication › Users › Add user: email naat@users.invalid, Auto Confirm User).
-- Run in Supabase › SQL Editor. Change 'naat' if you chose another username.
insert into app_users (id, username, must_change_password)
select id, 'naat', false from auth.users where email = 'naat@users.invalid'
on conflict (id) do nothing;

insert into user_roles (user_id, role)
select id, 'coordinator' from app_users where username = 'naat'
  and not exists (select 1 from user_roles r where r.user_id = app_users.id and r.role = 'coordinator');

select u.username, r.role from app_users u join user_roles r on r.user_id = u.id;
