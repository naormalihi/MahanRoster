-- Saving "אנשי קשר לחיילים" failed with "DELETE requires a WHERE clause": through the API the
-- database refuses a delete without a where (pg_safeupdate). Same function, the delete has one.

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
  -- with a where: the API refuses a delete without one (safeupdate)
  delete from soldier_contacts where user_id is not null;
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
