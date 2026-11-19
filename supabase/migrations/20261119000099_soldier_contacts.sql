-- =============================================================================
-- "למי לפנות": wherever a soldier reads "פנה לנע"ת", also who that is and how to reach him.
--
-- * soldier_contacts: the users נע"ת chose to show soldiers – a name as soldiers know him, and a
--   phone (written here, or else the one on his own soldier card). Only those chosen are shown;
--   no other staff phone opens to soldiers.
-- * public.my_contacts(): for the signed-in user – up to two of נע"ת / מ"מ, and the commander of
--   his own gaf if one was chosen. Only active, unlocked accounts with the role today.
-- * public.soldier_contacts_list() / set_soldier_contacts(): the settings screen (נע"ת).
-- =============================================================================

create table if not exists soldier_contacts (
  user_id      uuid primary key references app_users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  phone        text check (phone ~ '^9725[0-9]{8}$'),
  sort         smallint not null default 0,
  updated_at   timestamptz not null default now()
);
alter table soldier_contacts enable row level security;   -- through the functions below only

-- the role a contact is shown with today (the highest one he holds), or null when none counts
create or replace function app.contact_role(p_user uuid) returns table (role app_role, gaf_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select ur.role, coalesce(ur.gaf_id, own.gaf_id)
  from user_roles ur
  join app_users u on u.id = ur.user_id
  left join soldiers own on own.id = u.soldier_id
  where ur.user_id = p_user and not u.is_locked and u.deleted_at is null
    and ur.role in ('coordinator', 'deputy', 'gaf_commander')
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now())
  order by array_position(array['coordinator', 'deputy', 'gaf_commander']::app_role[], ur.role)
  limit 1
$$;
revoke execute on function app.contact_role(uuid) from public, anon, authenticated;

create or replace function public.my_contacts()
returns table (display_name text, role_label text, phone text, kind text)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select s.gaf_id from app_users u join soldiers s on s.id = u.soldier_id where u.id = auth.uid()
  ), c as (
    select sc.display_name, sc.sort, coalesce(sc.phone, own.phone) as phone, r.role, r.gaf_id
    from soldier_contacts sc
    join app_users u on u.id = sc.user_id
    left join soldiers own on own.id = u.soldier_id
    cross join lateral app.contact_role(sc.user_id) r
  )
  (select display_name, case role when 'coordinator' then 'נע"ת התורנויות' else 'ממלא מקום נע"ת' end, phone, 'staff'
     from c where auth.uid() is not null and role in ('coordinator', 'deputy')
     order by role, sort, display_name limit 2)
  union all
  (select display_name, 'מפקד הגף', phone, 'gaf'
     from c where role = 'gaf_commander' and gaf_id = (select gaf_id from mine)
     order by sort, display_name limit 1)
$$;
revoke execute on function public.my_contacts() from public, anon;
grant execute on function public.my_contacts() to authenticated;

create or replace function public.soldier_contacts_list()
returns table (user_id uuid, display_name text, phone text, card_phone text, sort smallint, role app_role)
language sql stable security definer set search_path = public, pg_temp as $$
  select sc.user_id, sc.display_name, sc.phone, own.phone, sc.sort, (select r.role from app.contact_role(sc.user_id) r)
  from soldier_contacts sc
  join app_users u on u.id = sc.user_id
  left join soldiers own on own.id = u.soldier_id
  where app.is_staff()
  order by sc.sort, sc.display_name
$$;
revoke execute on function public.soldier_contacts_list() from public, anon;
grant execute on function public.soldier_contacts_list() to authenticated;

-- the whole list at once: [{user_id, display_name, phone}], in the order shown
create or replace function public.set_soldier_contacts(p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  i int := 0;
  ph text;
begin
  perform app.require_coordinator();
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 20 then raise exception 'רשימה לא תקינה'; end if;
  delete from soldier_contacts;
  for e in select * from jsonb_array_elements(p) loop
    if not exists (select 1 from app.contact_role((e->>'user_id')::uuid)) then
      raise exception 'איש קשר חייב להיות נע"ת, מ"מ או מפקד גף פעיל';
    end if;
    ph := nullif(regexp_replace(coalesce(e->>'phone', ''), '\D', '', 'g'), '');
    if ph like '05%' then ph := '972' || substr(ph, 2); end if;
    if ph is not null and ph !~ '^9725[0-9]{8}$' then raise exception 'מספר טלפון לא תקין: %', e->>'phone'; end if;
    insert into soldier_contacts (user_id, display_name, phone, sort)
    values ((e->>'user_id')::uuid, btrim(e->>'display_name'), ph, i);
    i := i + 1;
  end loop;
  insert into audit_log (actor_user_id, action, entity_type, after)
  values (auth.uid(), 'set_soldier_contacts', 'soldier_contacts', jsonb_build_object('count', i));
  return i;
end $$;
revoke execute on function public.set_soldier_contacts(jsonb) from public, anon;
grant execute on function public.set_soldier_contacts(jsonb) to authenticated;
