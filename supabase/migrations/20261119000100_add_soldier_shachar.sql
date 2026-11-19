-- "הוספת חייל": also שח"ר (mandatory service only) and the date he signed for a second role
-- (continued career service), as on the soldier's card.
create or replace function public.add_soldier(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  key text := p ->> 'soldier_key';
  ex soldiers;
  gname text;
  sid uuid;
  joined date := coalesce((p ->> 'unit_join_date')::date, current_date);
begin
  perform app.require_staff();
  if key !~ '^[0-9a-f]{64}$' then raise exception 'מפתח החייל לא תקין – בדוק את מפתח היחידה'; end if;
  if coalesce(trim(p ->> 'full_name'), '') = '' then raise exception 'חסר שם'; end if;
  select * into ex from soldiers where soldier_key = key;
  if found then
    select name into gname from org_units where id = ex.gaf_id;
    return jsonb_build_object('status', case when ex.is_active then 'exists' else 'inactive' end,
                              'id', ex.id, 'name', ex.full_name, 'gaf', gname);
  end if;
  insert into soldiers (soldier_key, full_name, service_type, gender, gaf_id, computed_rank_id, enlistment_date,
                        release_date, career_start_date, range_valid_until, parent_status, home_nightly, phone, unit_join_date,
                        is_shachar, second_role_signed_at)
  values (key, trim(p ->> 'full_name'), (p ->> 'service_type')::service_type, nullif(p ->> 'gender', '')::gender_type,
          (p ->> 'gaf_id')::uuid, nullif(p ->> 'rank_id', '')::uuid, nullif(p ->> 'enlistment_date', '')::date,
          nullif(p ->> 'release_date', '')::date, nullif(p ->> 'career_start_date', '')::date,
          nullif(p ->> 'range_valid_until', '')::date, coalesce((p ->> 'parent_status')::boolean, false),
          coalesce((p ->> 'home_nightly')::boolean, false), nullif(p ->> 'phone', ''), joined,
          coalesce((p ->> 'is_shachar')::boolean, false) and (p ->> 'service_type') = 'mandatory',
          nullif(p ->> 'second_role_signed_at', '')::date)
  returning id into sid;
  insert into audit_log (actor_user_id, action, entity_type, entity_id, after)
  values (auth.uid(), 'add_soldier', 'soldiers', sid::text, jsonb_build_object('full_name', trim(p ->> 'full_name'), 'unit_join_date', joined));
  perform app.resnapshot_open_cycles(joined);
  return jsonb_build_object('status', 'added', 'id', sid);
end $$;
