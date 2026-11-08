-- =============================================================================
-- History import and opening scores.
--
-- History: before the first run נע"ת loads the duties of the last half year from a template
-- (personal number → soldier key in the browser, date, duty, activated reserve, penalty). Each
-- row is stored with its points, computed like a slot's (weights, multipliers, load factor of
-- that day; a penalty duty scores 0). An import counts only after it is approved; it can be
-- deleted as a whole. Approved history enters the baseline exactly like done assignments.
--
-- Opening scores, created by the snapshot of a cycle (and recreated when it is taken again):
-- * new soldier – no duty in the window (history or done), no earlier opening and no manual
--   opening score: starts at the mean of his fairness group, dated the end of his grace period
--   (or the day before the cycle). So a soldier without history does not absorb everything.
-- * return from a long absence – a crediting absence (not by choice) or a full exemption of at
--   least long_absence_months that ended in the window or the cycle: raised to the group mean
--   on the return day, if below it.
-- * second role (signed career) – raised to the group mean on the signing date, if below.
-- The mean is that of the group's other soldiers (not those receiving an opening). Adjustments
-- dated inside the cycle now count in its baseline.
-- =============================================================================

create table history_imports (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  rows        int not null default 0,
  created_by  uuid references app_users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references app_users(id)
);

create table history_duties (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references history_imports(id) on delete cascade,
  line              int,
  soldier_id        uuid not null references soldiers(id),
  task_type_id      uuid not null references task_types(id),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null check (ends_at > starts_at),
  reserve_activated boolean not null default false,
  is_penalty        boolean not null default false,
  points            numeric(6,2) not null default 0,
  normalized_points numeric(8,2) not null default 0,
  weekend_units     int not null default 0
);
create index on history_duties (soldier_id, starts_at);
create index on history_duties (import_id);

alter table history_imports enable row level security;
alter table history_duties enable row level security;
create policy staff_all on history_imports for all to authenticated using (app.is_staff()) with check (app.is_staff());
create policy staff_all on history_duties for all to authenticated using (app.is_staff()) with check (app.is_staff());
revoke all on history_imports, history_duties from anon;
create trigger history_imports_audit after insert or update or delete on history_imports
  for each row execute function app.audit();

alter table score_adjustments add column if not exists cycle_id uuid references cycles(id) on delete cascade;
comment on column score_adjustments.cycle_id is 'Set on opening points created by the snapshot of this cycle (recomputed with it).';

-- ---------------------------------------------------------------------------
-- Points of a duty, like a slot's (app.slot_points is now a wrapper)
-- ---------------------------------------------------------------------------
create or replace function app.duty_points(p_task uuid, p_from timestamptz, p_to timestamptz, p_soldier uuid, p_penalty boolean)
returns table (raw numeric, normalized numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select * from task_types where id = p_task),
  span as (
    select (p_from at time zone app.tz()) as a, (p_to at time zone app.tz()) as b,
           extract(epoch from p_to - p_from) / 60 as minutes
  ),
  night as (
    select case
      when span.minutes < 24 * 60
       and app.window_minutes(app.setting('night_window') #>> '{}', span.a, span.b) > span.minutes / 2
      then (app.setting('night_multiplier') #>> '{}')::numeric else 1 end as m
    from span
  ),
  units as (
    select (span.a + i * interval '24 hours')::date as day
    from span cross join generate_series(0, ceil(span.minutes / (24 * 60))::int - 1) i
  ),
  scored as (
    select u.day,
      t.weight * greatest(
        1,
        case when exists (select 1 from calendar_days c where c.day = u.day and c.day_type in ('holiday', 'holiday_eve'))
             then (app.setting('holiday_multiplier') #>> '{}')::numeric else 1 end,
        case when not t.is_weekend_type
              and extract(isodow from u.day)::int in (select jsonb_array_elements_text(app.setting('weekend_weekdays'))::int)
             then (app.setting('weekend_multiplier') #>> '{}')::numeric else 1 end
      ) * (select m from night) as p,
      coalesce((select min(lr.factor) from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
                where slr.soldier_id = p_soldier and slr.valid_from <= u.day
                  and (slr.valid_to is null or slr.valid_to >= u.day)), 1) as f
    from units u cross join t
  )
  select case when p_penalty then 0 else round(coalesce(sum(p), 0), 2) end,
         case when p_penalty then 0 else round(coalesce(sum(p / f), 0), 2) end
  from scored
$$;

create or replace function app.slot_points(p_slot uuid, p_soldier uuid)
returns table (raw numeric, normalized numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.raw, d.normalized
  from slots s cross join lateral app.duty_points(s.task_type_id, s.starts_at, s.ends_at, p_soldier, s.is_penalty_slot) d
  where s.id = p_slot
$$;
revoke execute on function app.duty_points(uuid, timestamptz, timestamptz, uuid, boolean) from anon, public;
grant execute on function app.duty_points(uuid, timestamptz, timestamptz, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Import (unapproved), approve, delete
-- ---------------------------------------------------------------------------
-- p_rows: [{line, soldier_id, task_type_id, starts_at, ends_at, reserve_activated, is_penalty}]
create or replace function public.import_history(p_file text, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare imp uuid;
begin
  perform app.require_staff();
  insert into history_imports (file_name) values (p_file) returning id into imp;
  insert into history_duties (import_id, line, soldier_id, task_type_id, starts_at, ends_at, reserve_activated, is_penalty,
                              points, normalized_points, weekend_units)
  select imp, (r ->> 'line')::int, (r ->> 'soldier_id')::uuid, (r ->> 'task_type_id')::uuid,
         (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz,
         coalesce((r ->> 'reserve_activated')::boolean, false), coalesce((r ->> 'is_penalty')::boolean, false),
         d.raw, d.normalized,
         case when coalesce((r ->> 'is_penalty')::boolean, false) then 0
              else app.weekend_units((r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz) end
  from jsonb_array_elements(p_rows) r
  cross join lateral app.duty_points((r ->> 'task_type_id')::uuid, (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz,
                                     (r ->> 'soldier_id')::uuid, coalesce((r ->> 'is_penalty')::boolean, false)) d;
  update history_imports set rows = (select count(*) from history_duties where import_id = imp) where id = imp;
  return imp;
end $$;

create or replace function public.approve_history(p_import uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  update history_imports set approved_at = now(), approved_by = auth.uid() where id = p_import and approved_at is null;
end $$;

create or replace function public.delete_history(p_import uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_staff();
  delete from history_imports where id = p_import;
end $$;

revoke execute on function public.import_history(text, jsonb), public.approve_history(uuid), public.delete_history(uuid) from anon, public;
grant execute on function public.import_history(text, jsonb), public.approve_history(uuid), public.delete_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opening scores of a cycle
-- ---------------------------------------------------------------------------
create or replace function app.apply_opening_scores(p_cycle uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c         cycles;
  win_from  date;
  grace     int := (app.setting('grace_days') #>> '{}')::int;
  long_m    int := (app.setting('long_absence_months') #>> '{}')::int;
begin
  select * into c from cycles where id = p_cycle;
  win_from := c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);

  create temp table if not exists _opening (soldier_id uuid, reason text, effective date, kind text) on commit drop;
  truncate _opening;

  -- new soldiers: nothing in the window, no earlier opening, no manual opening score
  insert into _opening
  select sn.soldier_id, 'new_soldier',
         least(c.end_date, greatest(c.start_date - 1, coalesce(s.unit_join_date + grace, c.start_date - 1))), 'set'
  from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
  where sn.cycle_id = p_cycle and sn.fairness_group not like '%:none'
    and s.opening_score is null
    and not exists (select 1 from score_adjustments sa where sa.soldier_id = s.id and sa.reason = 'new_soldier')
    and not exists (select 1 from history_duties h join history_imports hi on hi.id = h.import_id and hi.approved_at is not null
                    where h.soldier_id = s.id and h.starts_at >= win_from::timestamp at time zone app.tz()
                      and h.starts_at < c.start_date::timestamp at time zone app.tz())
    and not exists (select 1 from assignments a join slots sl on sl.id = a.slot_id
                    where a.soldier_id = s.id and a.status in ('done', 'reserve_activated')
                      and sl.starts_at >= win_from::timestamp at time zone app.tz()
                      and sl.starts_at < c.start_date::timestamp at time zone app.tz());

  -- back from a long absence that was not by choice (or a full exemption)
  insert into _opening
  select distinct on (x.soldier_id) x.soldier_id, 'return_from_absence', x.back, 'raise'
  from (
    select a.soldier_id, ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date + 1 as back,
           (a.starts_at at time zone app.tz())::date as since
    from absences a join absence_types t on t.id = a.absence_type_id
    where a.status = 'active' and t.credits_load
    union all
    select e.soldier_id, e.end_date + 1, e.start_date
    from exemptions e join exemption_types et on et.id = e.exemption_type_id
    where e.status = 'approved' and not et.qualifies_day_only and e.restricted_hours is null
      and app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) is null
  ) x
  join cycle_soldier_snapshot sn on sn.cycle_id = p_cycle and sn.soldier_id = x.soldier_id
  where x.back > x.since + make_interval(months => long_m) and x.back between win_from and c.end_date
    and x.soldier_id not in (select soldier_id from _opening)
    and not exists (select 1 from score_adjustments sa
                    where sa.soldier_id = x.soldier_id and sa.reason = 'return_from_absence' and sa.effective_date = x.back)
  order by x.soldier_id, x.back desc;

  -- second role (signed career service)
  insert into _opening
  select s.id, 'second_role', s.second_role_signed_at, 'raise'
  from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
  where sn.cycle_id = p_cycle and s.second_role_signed_at between win_from and c.end_date
    and s.id not in (select soldier_id from _opening)
    and not exists (select 1 from score_adjustments sa
                    where sa.soldier_id = s.id and sa.reason = 'second_role' and sa.effective_date = s.second_role_signed_at);

  -- the group mean without the soldiers receiving an opening
  insert into score_adjustments (soldier_id, points, effective_date, reason, population, note, cycle_id)
  select o.soldier_id,
         round(case when o.kind = 'set' then g.mean else g.mean - sn.baseline_score end, 2),
         o.effective, o.reason, sn.balance_population,
         'ממוצע הקבוצה ' || round(g.mean, 2) || ' (' || sn.fairness_label || ')', p_cycle
  from _opening o
  join cycle_soldier_snapshot sn on sn.cycle_id = p_cycle and sn.soldier_id = o.soldier_id
  cross join lateral (
    select coalesce(avg(m.baseline_score), 0) as mean from cycle_soldier_snapshot m
    where m.cycle_id = p_cycle and m.fairness_group = sn.fairness_group
      and m.soldier_id not in (select soldier_id from _opening)
  ) g
  where (o.kind = 'set' and g.mean > 0) or (o.kind = 'raise' and g.mean > sn.baseline_score);

  update cycle_soldier_snapshot sn
  set baseline_score = sn.baseline_score + sa.points
  from score_adjustments sa
  where sa.cycle_id = p_cycle and sn.cycle_id = p_cycle and sa.soldier_id = sn.soldier_id;
end $$;
revoke execute on function app.apply_opening_scores(uuid) from anon, public;

-- ---------------------------------------------------------------------------
-- Snapshot: history in the baseline, adjustments up to the cycle's end, opening scores
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_cycle(p_cycle uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  win_from date;
  n        int;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  win_from := c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);

  delete from cycle_soldier_snapshot where cycle_id = p_cycle;
  -- opening points this cycle created before are computed again below
  delete from score_adjustments where cycle_id = p_cycle;

  insert into cycle_soldier_snapshot (
    cycle_id, soldier_id, service_type, rank_id, rank_order, populations, balance_population,
    is_parent, qualifies_day_only, is_shachar, baseline_score, baseline_weekends, baseline_reserves)
  select
    p_cycle,
    s.id,
    svc.v,
    r.id,
    r.sort_order,
    array(select distinct x from unnest(array[svc.v::text] || coalesce(r.population_tags, '{}')) x order by x),
    svc.v::text,
    parent.v,
    parent.v or exists (
      select 1 from exemptions e join exemption_types et on et.id = e.exemption_type_id
      where e.soldier_id = s.id and e.status = 'approved' and et.qualifies_day_only
        and e.start_date <= c.end_date and e.end_date >= c.start_date),
    s.is_shachar,
    coalesce(hist.points, 0)
      + coalesce((select sum(points) from score_adjustments sa
                  where sa.soldier_id = s.id and sa.effective_date >= win_from and sa.effective_date <= c.end_date), 0)
      -- imported history (approved), normalized
      + coalesce(imp.points, 0)
      + case when s.opening_score_at >= win_from then coalesce(s.opening_score, 0) else 0 end
      -- availability credits of earlier published cycles inside the window
      + coalesce((select sum(cc.points) from cycle_credits cc join cycles pc on pc.id = cc.cycle_id
                  where cc.soldier_id = s.id and pc.status in ('published', 'closed')
                    and pc.start_date >= win_from and pc.start_date < c.start_date), 0),
    coalesce(hist.weekends, 0) + coalesce(imp.weekends, 0),
    coalesce(hist.reserves, 0) + coalesce(imp.reserves, 0)
  from soldiers s
  left join lateral (
    select case when s.appointment_rank_id is not null
                 and (s.appointment_rank_until is null or s.appointment_rank_until >= c.start_date)
                then s.appointment_rank_id else s.computed_rank_id end as rank_id
  ) rk on true
  left join ranks r on r.id = rk.rank_id
  cross join lateral (select app.service_on(s.career_start_date, s.service_type, c.start_date) as v) svc
  cross join lateral (
    select case when s.parent_override is not null
                 and (s.parent_override_until is null or s.parent_override_until >= c.start_date)
                then s.parent_override else s.parent_status end as v
  ) parent
  left join lateral (
    select
      sum(a.normalized_points) filter (where a.status in ('done', 'reserve_activated'))  as points,
      sum(a.weekend_units)     filter (where a.status in ('done', 'reserve_activated'))  as weekends,
      count(*) filter (where a.role = 'reserve' and a.status in ('reserve_idle', 'reserve_activated', 'assigned')) as reserves
    from assignments a join slots sl on sl.id = a.slot_id
    where a.soldier_id = s.id
      and sl.starts_at >= win_from::timestamp at time zone app.tz()
      and sl.starts_at <  c.start_date::timestamp at time zone app.tz()
  ) hist on true
  left join lateral (
    select sum(h.normalized_points) as points,
           sum(h.weekend_units)     as weekends,
           count(*) filter (where h.reserve_activated) as reserves
    from history_duties h join history_imports hi on hi.id = h.import_id and hi.approved_at is not null
    where h.soldier_id = s.id
      and h.starts_at >= win_from::timestamp at time zone app.tz()
      and h.starts_at <  c.start_date::timestamp at time zone app.tz()
  ) imp on true
  where s.is_active
    and (s.release_date is null or s.release_date >= c.start_date)
    and (s.enlistment_date is null or s.enlistment_date <= c.end_date);

  get diagnostics n = row_count;
  perform app.assign_fairness_groups(p_cycle);
  perform app.apply_opening_scores(p_cycle);
  return n;
end $$;


