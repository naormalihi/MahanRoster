-- =============================================================================
-- 1. Gaf rows named by a full framework path ("מה"ן - מלמסים/גף ענן/צוות …") – created by
--    HR loads before the gaf column was parsed – are merged into the gaf they name
--    ("גף ענן"). Every reference moves to the real gaf (assignments keep the gaf of the
--    time, now under its proper name), and the path row is closed and marked merged.
-- 2. The board view also returns the gaf of each performer and reserve, in name order.
-- =============================================================================

create or replace function app.merge_gaf_paths() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n       int := 0;
  u       org_units;
  gname   text;
  target  uuid;
  fk      record;
begin
  for u in select * from org_units where kind = 'gaf' and name like '%/%' and merged_into_id is null loop
    select trim(regexp_replace(trim(p), '\s+-\s+.*$', '')) into gname
    from unnest(string_to_array(u.name, '/')) p
    where trim(p) ~ '^גף\s' limit 1;
    continue when gname is null or gname = u.name;

    select id into target from org_units where kind = 'gaf' and name = gname;
    if target is null then
      insert into org_units (kind, name, parent_id) values ('gaf', gname, u.parent_id) returning id into target;
    end if;

    for fk in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'org_units'::regclass and cardinality(c.conkey) = 1
        and c.conrelid not in ('org_units'::regclass, 'gaf_aliases'::regclass)
    loop
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using target, u.id;
    end loop;
    update gaf_aliases set gaf_id = target where gaf_id = u.id;
    update org_units set parent_id = target where parent_id = u.id;
    update org_units set active_to = current_date, merged_into_id = target where id = u.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.merge_gaf_paths() from anon, public, authenticated;

select app.merge_gaf_paths();

create or replace view published_board with (security_barrier = true) as
select
  s.id                                              as slot_id,
  c.id                                              as cycle_id,
  s.starts_at,
  s.ends_at,
  tt.name                                           as task_name,
  dc.name                                           as category_name,
  tt.color,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'performer'), '{}') as performers,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'reserve'),   '{}') as reserves,
  coalesce(array_agg(distinct g.name) filter (where a.role = 'performer'), '{}')                   as gafim,
  s.report_at,
  s.report_place,
  s.briefing_at,
  s.briefing_place,
  greatest(s.updated_at, max(a.updated_at))         as updated_at,
  greatest(s.updated_at, max(a.updated_at)) > c.published_at as changed_after_publish,
  s.instructions,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'performer'), '{}') as performer_gafim,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'reserve'),   '{}') as reserve_gafim
from slots s
join cycles c          on c.id = s.cycle_id and c.status in ('published', 'closed')
join task_types tt     on tt.id = s.task_type_id
left join duty_categories dc on dc.id = tt.category_id
left join assignments a on a.slot_id = s.id
                       and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
left join soldiers so  on so.id = a.soldier_id
left join org_units g  on g.id = a.gaf_id
where s.cancelled_at is null
  and app.can_view_board()
group by s.id, c.id, tt.name, dc.name, tt.color;
