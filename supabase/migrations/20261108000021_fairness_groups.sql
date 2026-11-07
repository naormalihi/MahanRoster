-- =============================================================================
-- Fairness groups and availability credits.
--
-- Fairness group: inside a balance population (חובה / קבע), soldiers are compared only
-- with soldiers they can share load with – the connected component of the duty
-- categories open to them (by the static eligibility of the potential, with overrides).
-- Mandatory enlisted (רס"ר + שמירות) and mandatory officers (קצין תורן, מפקד שער…) share
-- no duty, so they are two groups and each has its own mean. A soldier with no open
-- category is in "<population>:none" and takes no part in the balance.
--
-- Availability credit: a soldier who is not in the unit for part of the cycle for a
-- reason that is not his choice – before enlistment, after release, the grace period,
-- a full exemption, or an absence of a crediting type (course, sickness) of at least
-- credit_absence_min_days – is credited, for each such day, the group's average load
-- per available day. So someone who arrives a third into the cycle carries about two
-- thirds of a full share instead of catching up. Absences by choice (leave, abroad) are
-- not credited: the soldier makes up the load later. The engine computes the credit
-- per month; it is stored per cycle (cycle_credits) and counts in later baselines once
-- the cycle is published.
-- =============================================================================

alter table absence_types add column if not exists credits_load boolean not null default false;
comment on column absence_types.credits_load is 'Not by choice: a long absence of this type is credited with the group''s average load.';
update absence_types set credits_load = true where name in ('קורס', 'מחלה');

insert into settings (key, value) values ('credit_absence_min_days', '7') on conflict (key) do nothing;

alter table cycle_soldier_snapshot
  add column if not exists fairness_group text,
  add column if not exists fairness_label text;

create table if not exists cycle_credits (
  cycle_id   uuid not null references cycles(id) on delete cascade,
  soldier_id uuid not null references soldiers(id),
  days       int not null,
  points     numeric(8,2) not null,
  primary key (cycle_id, soldier_id)
);
alter table cycle_credits enable row level security;
create policy staff_all on cycle_credits for all to authenticated using (app.is_staff()) with check (app.is_staff());
revoke all on cycle_credits from anon;

-- ---------------------------------------------------------------------------
-- Groups: connected components of open categories, per balance population
-- ---------------------------------------------------------------------------
create or replace function app.assign_fairness_groups(p_cycle uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  with recursive o as (
    select distinct ps.soldier_id, ps.category_id, sn.balance_population as pop
    from app.potential_static(p_cycle) ps
    join cycle_soldier_snapshot sn on sn.cycle_id = p_cycle and sn.soldier_id = ps.soldier_id
    left join potential_overrides po on po.cycle_id = p_cycle and po.soldier_id = ps.soldier_id and po.category_id = ps.category_id
    where (ps.reasons = '{}' and coalesce(po.value, 1) > 0) or po.value > 0
  ),
  e as (select distinct a.pop, a.category_id as c1, b.category_id as c2 from o a join o b on b.soldier_id = a.soldier_id),
  r (pop, c1, c2) as (
    select pop, c1, c2 from e
    union
    select r.pop, r.c1, e.c2 from r join e on e.pop = r.pop and e.c1 = r.c2
  ),
  comp as (select pop, c1 as category_id, array_agg(c2 order by c2) as members from r group by pop, c1),
  lbl as (
    select comp.pop, comp.category_id, comp.members[1] as root,
      (select string_agg(dc.name, ' + ' order by dc.name) from duty_categories dc where dc.id = any(comp.members)) as label
    from comp
  ),
  per_soldier as (
    select distinct on (o.soldier_id) o.soldier_id, o.pop || ':' || lbl.root::text as grp, lbl.label
    from o join lbl on lbl.pop = o.pop and lbl.category_id = o.category_id
    order by o.soldier_id
  )
  update cycle_soldier_snapshot sn
  set fairness_group = coalesce((select ps.grp from per_soldier ps where ps.soldier_id = sn.soldier_id), sn.balance_population || ':none'),
      fairness_label = coalesce((select ps.label from per_soldier ps where ps.soldier_id = sn.soldier_id), 'ללא תורנות פתוחה')
  where sn.cycle_id = p_cycle
$$;
revoke execute on function app.assign_fairness_groups(uuid) from anon, public;

-- Overrides change what is open: keep the groups current while the potential is edited.
create or replace function app.potential_overrides_regroup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.assign_fairness_groups(coalesce(new.cycle_id, old.cycle_id));
  return null;
end $$;
drop trigger if exists potential_overrides_regroup on potential_overrides;
create trigger potential_overrides_regroup after insert or update or delete on potential_overrides
  for each row execute function app.potential_overrides_regroup();

-- ---------------------------------------------------------------------------
-- Credited periods of a soldier inside [p_from, p_to], as [{start, end}] (inclusive days)
-- ---------------------------------------------------------------------------
create or replace function app.credit_periods(s soldiers, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with p (a, b) as (
    select p_from, s.enlistment_date - 1 where s.enlistment_date > p_from
    union all
    select s.release_date + 1, p_to where s.release_date < p_to
    union all
    select s.unit_join_date, s.unit_join_date + ((app.setting('grace_days') #>> '{}')::int - 1)
    where s.unit_join_date is not null
    union all
    select (a.starts_at at time zone app.tz())::date, ((a.ends_at - interval '1 microsecond') at time zone app.tz())::date
    from absences a join absence_types t on t.id = a.absence_type_id
    where a.soldier_id = s.id and a.status = 'active' and t.credits_load
      and a.ends_at - a.starts_at >= make_interval(days => (app.setting('credit_absence_min_days') #>> '{}')::int)
    union all
    select e.start_date, e.end_date
    from exemptions e join exemption_types et on et.id = e.exemption_type_id
    where e.soldier_id = s.id and e.status = 'approved' and not et.qualifies_day_only
      and e.restricted_hours is null and app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('start', greatest(a, p_from), 'end', least(b, p_to)) order by a), '[]')
  from p where a <= p_to and b >= p_from and greatest(a, p_from) <= least(b, p_to)
$$;
revoke execute on function app.credit_periods(soldiers, date, date) from anon, public;

-- ---------------------------------------------------------------------------
-- Store the engine's credits when a run is applied
-- ---------------------------------------------------------------------------
create or replace function app.store_cycle_credits() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.kind in ('full', 'stability')
     and jsonb_typeof(new.result -> 'credits') = 'array' then
    delete from cycle_credits where cycle_id = new.cycle_id;
    insert into cycle_credits (cycle_id, soldier_id, days, points)
    select new.cycle_id, (x ->> 'soldier_id')::uuid, (x ->> 'days')::int, (x ->> 'points')::numeric
    from jsonb_array_elements(new.result -> 'credits') x
    where exists (select 1 from soldiers where id = (x ->> 'soldier_id')::uuid);
  end if;
  return new;
end $$;
drop trigger if exists schedule_jobs_credits on schedule_jobs;
create trigger schedule_jobs_credits after update on schedule_jobs
  for each row execute function app.store_cycle_credits();

-- ---------------------------------------------------------------------------
-- Snapshot (adds earlier credits to the baseline, then groups)
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
                  where sa.soldier_id = s.id and sa.effective_date >= win_from and sa.effective_date < c.start_date), 0)
      + case when s.opening_score_at >= win_from then coalesce(s.opening_score, 0) else 0 end
      -- availability credits of earlier published cycles inside the window
      + coalesce((select sum(cc.points) from cycle_credits cc join cycles pc on pc.id = cc.cycle_id
                  where cc.soldier_id = s.id and pc.status in ('published', 'closed')
                    and pc.start_date >= win_from and pc.start_date < c.start_date), 0),
    coalesce(hist.weekends, 0),
    coalesce(hist.reserves, 0)
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
  where s.is_active
    and (s.release_date is null or s.release_date >= c.start_date)
    and (s.enlistment_date is null or s.enlistment_date <= c.end_date);

  get diagnostics n = row_count;
  perform app.assign_fairness_groups(p_cycle);
  return n;
end $$;


-- ---------------------------------------------------------------------------
-- Engine input: the group and the credited periods of each soldier
-- ---------------------------------------------------------------------------
create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  c_from   timestamptz;
  c_to     timestamptz;
  doc      jsonb;
  last_day date;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'cycle % has no snapshot – run snapshot_cycle first', p_cycle;
  end if;
  c_from := c.start_date::timestamp at time zone app.tz();
  c_to   := (c.end_date + 1)::timestamp at time zone app.tz();
  -- an assumed-valid range covers every slot of the cycle, also one that ends after the cycle
  select greatest(c.end_date, max((sl.ends_at at time zone app.tz())::date)) into last_day
  from slots sl where sl.cycle_id = p_cycle and sl.cancelled_at is null;
  last_day := coalesce(last_day, c.end_date);

  doc := jsonb_build_object(
    'cycle_id',    p_cycle::text,
    'cycle_start', c.start_date,
    'cycle_end',   c.end_date,

    'task_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id::text, 'name', t.name, 'weight', t.weight, 'min_rest_hours', t.min_rest_hours,
        'service_restriction', t.service_restriction, 'requires_weapon', t.requires_weapon,
        'is_weekend_type', t.is_weekend_type, 'shachar_compatible', t.shachar_compatible,
        'qualifying_duty', t.qualifying_duty, 'eligible_populations', to_jsonb(t.eligible_populations),
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', t.gender,
        'category_id', t.category_id::text) order by t.code)
      from task_types t
      left join ranks rmin on rmin.id = t.rank_min_id
      left join ranks rmax on rmax.id = t.rank_max_id
      where t.id in (select task_type_id from slots where cycle_id = p_cycle)), '[]'),

    'soldiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'gaf_id', s.gaf_id::text, 'service_type', sn.service_type,
        'rank_order', coalesce(sn.rank_order, 0), 'populations', to_jsonb(sn.populations),
        'gender', s.gender, 'enlistment_date', s.enlistment_date, 'release_date', s.release_date,
        'unit_join_date', s.unit_join_date,
        -- no range date on file = assumed valid for the whole cycle, while the setting is on
        'range_valid_until', coalesce(s.range_valid_until,
          case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_day end),
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'home_nightly', app.home_nightly_on(s, c.start_date),
        'balance_population', sn.balance_population, 'baseline_score', sn.baseline_score,
        'fairness_group', sn.fairness_group,
        'credit_periods', app.credit_periods(s, c.start_date, last_day),
        'baseline_weekends', sn.baseline_weekends, 'baseline_reserves', sn.baseline_reserves,
        'load_roles', coalesce((
          select jsonb_agg(jsonb_build_object('factor', lr.factor, 'valid_from', slr.valid_from, 'valid_to', slr.valid_to))
          from soldier_load_roles slr join load_roles lr on lr.id = slr.load_role_id
          where slr.soldier_id = s.id
            and slr.valid_from <= c.end_date and (slr.valid_to is null or slr.valid_to >= c.start_date)), '[]')
        ) order by s.id)
      from cycle_soldier_snapshot sn join soldiers s on s.id = sn.soldier_id
      where sn.cycle_id = p_cycle), '[]'),

    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sl.id::text, 'task_type_id', sl.task_type_id::text,
        'starts_at', app.local_ts(sl.starts_at), 'ends_at', app.local_ts(sl.ends_at),
        'performers_needed', sl.performers_needed, 'reserves_needed', sl.reserves_needed,
        'rank_min', rmin.sort_order, 'rank_max', rmax.sort_order, 'gender', sl.gender,
        'allowed_ranks', (select jsonb_agg(distinct r.sort_order) from ranks r where r.id = any(sl.allowed_rank_ids)),
        'prefer_home_nightly', sl.prefer_home_nightly,
        'daily_hours', sl.daily_hours,
        'briefing_at', case when sl.briefing_at is not null then app.local_ts(sl.briefing_at) end,
        'is_penalty', sl.is_penalty_slot, 'penalty_soldier_id', pen.soldier_id::text
        ) order by sl.starts_at, sl.id)
      from slots sl
      left join ranks rmin on rmin.id = sl.rank_min_id
      left join ranks rmax on rmax.id = sl.rank_max_id
      left join penalties pen on pen.id = sl.penalty_id and pen.target_type = 'soldier'
      where sl.cycle_id = p_cycle and sl.cancelled_at is null), '[]'),

    'settings', jsonb_build_object(
      'weekend_multiplier', app.setting('weekend_multiplier'),
      'holiday_multiplier', app.setting('holiday_multiplier'),
      'night_multiplier',   app.setting('night_multiplier'),
      'night_window',       app.setting('night_window'),
      -- the engine uses Python weekdays (Monday = 0); settings use ISO (Monday = 1)
      'weekend_weekdays',   (select jsonb_agg(x::int - 1) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x),
      'grace_days',         app.setting('grace_days'),
      'duty_cap_per_month', app.setting('duty_cap_per_month'),
      'weights',            app.setting('solver_weights'),
      'time_limit_seconds', app.setting('solver_time_limit_seconds'),
      'workers',            4),

    'holidays', coalesce((
      select jsonb_agg(day order by day) from calendar_days
      where day_type in ('holiday', 'holiday_eve') and day between c.start_date - 1 and c.end_date + 1), '[]'),

    -- An exemption excludes the duties its type maps to, or the narrower list entered for it;
    -- a type with no mapping excludes everything. A qualifying exemption (ממלכ"ת יום only)
    -- is not an exclusion: its effect is in the snapshot (qualifies_day_only).
    'exemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', e.soldier_id::text, 'start_date', e.start_date, 'end_date', e.end_date,
        'excluded_task_type_ids', (select to_jsonb(array_agg(x::text)) from unnest(app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids)) x),
        'restricted_hours', e.restricted_hours,
        'qualifies_task_type_ids', coalesce((
          select jsonb_agg(d.task_type_id::text order by d.task_type_id) from exemption_type_duties d
          where d.exemption_type_id = e.exemption_type_id and d.effect = 'qualifies'), '[]')))
      from exemptions e join exemption_types et on et.id = e.exemption_type_id
      where e.status = 'approved' and not et.qualifies_day_only
        and e.start_date <= c.end_date and e.end_date >= c.start_date
        and e.soldier_id in (select soldier_id from cycle_soldier_snapshot where cycle_id = p_cycle)), '[]'),

    'absences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text, 'starts_at', app.local_ts(a.starts_at), 'ends_at', app.local_ts(a.ends_at)))
      from absences a
      where a.status = 'active' and a.starts_at < c_to and a.ends_at > c_from), '[]'),

    'date_blocks', coalesce((
      select jsonb_agg(jsonb_build_object('soldier_id', b.soldier_id::text, 'date', b.day))
      from date_blocks b where b.status = 'active' and b.day between c.start_date and c.end_date), '[]'),

    'personal_constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', pc.soldier_id::text, 'task_type_id', pc.task_type_id::text,
        'time_window', pc.time_window, 'valid_until', pc.valid_until))
      from personal_constraints pc where pc.valid_until is null or pc.valid_until >= c.start_date), '[]'),

    -- Kept as they are: manual locks always; in stability mode every published assignment too.
    'fixed', coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text, 'role', a.role))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
        and (a.source = 'manual' or (p_kind = 'stability' and a.status <> 'draft'))), '[]'),

    -- Duties from other cycles that reach into this one (rest included).
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'soldier_id', a.soldier_id::text,
        'starts_at', app.local_ts(sl.starts_at),
        'ends_at',   app.local_ts(sl.ends_at + make_interval(hours => t.min_rest_hours))))
      from assignments a join slots sl on sl.id = a.slot_id join task_types t on t.id = sl.task_type_id
      where sl.cycle_id <> p_cycle and sl.cancelled_at is null
        and a.status not in ('draft', 'dropped', 'cancelled_approved', 'swapped_out')
        and sl.starts_at < c_to
        and sl.ends_at + make_interval(hours => t.min_rest_hours) > c_from), '[]')
  );
  return doc;
end $$;

-- Existing snapshots get their groups now (the potential of a published cycle stays as it is).
do $$
declare cid uuid;
begin
  for cid in select distinct cycle_id from cycle_soldier_snapshot loop
    perform app.assign_fairness_groups(cid);
  end loop;
end $$;
