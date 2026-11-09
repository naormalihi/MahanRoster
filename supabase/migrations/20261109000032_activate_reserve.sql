-- Day-to-day: activating a reserve after publishing (the spec's "הקפצת עתודה תמיד").
--
-- activate_reserve(reserve assignment, from day unit, performer?, note):
--   * from unit 0: the performer is dropped (no points) and the reserve performs the whole duty.
--   * from unit k (a multi-day duty): the performer keeps the first k days (status done, their
--     points) and the reserve gets the rest.
--   * the reserve: status reserve_activated, with the points of its days.
-- After it the slot is missing a reserve: a stability run proposes one (the activated reserve
-- counts as the slot's performer there), and נע"ת approves it like any addition.

create or replace function public.activate_reserve(p_reserve uuid, p_from_unit int default 0,
                                                    p_performer uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   assignments;
  p   assignments;
  sl  slots;
  n   int;
  pts record;
begin
  perform app.require_staff();
  select * into r from assignments where id = p_reserve for update;
  if not found or r.role <> 'reserve' or r.status <> 'reserve_idle' then
    raise exception 'זו לא עתודה פעילה בלוח המפורסם';
  end if;
  select * into sl from slots where id = r.slot_id;
  if not exists (select 1 from cycles where id = sl.cycle_id and status = 'published') then
    raise exception 'הפעלת עתודה נעשית במחזור שפורסם';
  end if;

  -- the performer it replaces: the one named, else its pair, else the only performer
  select * into p from assignments
  where slot_id = sl.id and role = 'performer' and status = 'assigned'
    and (id = p_performer or (p_performer is null and (id = r.paired_assignment_id or
         (select count(*) from assignments x where x.slot_id = sl.id and x.role = 'performer' and x.status = 'assigned') = 1)))
  order by (id = r.paired_assignment_id) desc
  limit 1 for update;
  if not found then
    raise exception 'לא נמצא מבצע להחלפה – בחר את המבצע';
  end if;

  n := ceil(extract(epoch from sl.ends_at - sl.starts_at) / 86400)::int;
  if p_from_unit is null or p_from_unit < 0 or p_from_unit >= greatest(n, 1) then
    raise exception 'יום ההחלפה מחוץ לתורנות';
  end if;

  if p_from_unit = 0 then
    update assignments set status = 'dropped', points = 0, normalized_points = 0, weekend_units = 0,
           manual_reason = coalesce(p_note, 'העתודה הופעלה'), received_via = 'system', received_at = now()
     where id = p.id;
  else
    select * into pts from app.slot_points_units(sl.id, p.soldier_id, 0, p_from_unit);
    update assignments set status = 'done', points = pts.raw, normalized_points = pts.normalized,
           weekend_units = app.weekend_units(sl.starts_at, least(sl.ends_at, sl.starts_at + p_from_unit * interval '24 hours')),
           manual_reason = coalesce(p_note, 'העתודה הופעלה מהיממה ה-' || (p_from_unit + 1)),
           received_via = 'system', received_at = now()
     where id = p.id;
  end if;

  select * into pts from app.slot_points_units(sl.id, r.soldier_id, p_from_unit, null);
  update assignments set status = 'reserve_activated', points = pts.raw, normalized_points = pts.normalized,
         factor_at_time = case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         weekend_units = app.weekend_units(sl.starts_at + p_from_unit * interval '24 hours', sl.ends_at),
         replaced_assignment_id = p.id,
         manual_reason = coalesce(p_note, 'עתודה שהופעלה'), received_via = 'system', received_at = now()
   where id = r.id;
end $$;
revoke execute on function public.activate_reserve(uuid, int, uuid, text) from anon, public;
grant execute on function public.activate_reserve(uuid, int, uuid, text) to authenticated;

-- The board: an activated reserve is shown as a performer.
create or replace view published_board with (security_barrier = true) as
select
  s.id                                              as slot_id,
  c.id                                              as cycle_id,
  s.starts_at,
  s.ends_at,
  tt.name                                           as task_name,
  dc.name                                           as category_name,
  tt.color,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performers,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserves,
  coalesce(array_agg(distinct g.name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}')                   as gafim,
  s.report_at,
  s.report_place,
  s.briefing_at,
  s.briefing_place,
  greatest(s.updated_at, max(a.updated_at))         as updated_at,
  greatest(s.updated_at, max(a.updated_at)) > c.published_at as changed_after_publish,
  s.instructions,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performer_gafim,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserve_gafim
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

-- Engine input: the activated reserve is the slot's performer
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
        'allowed_ranks', (select jsonb_agg(distinct r.sort_order) from ranks r where r.id = any(t.allowed_rank_ids)),
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
        'is_penalty', sl.is_penalty_slot, 'penalty_soldier_id', pen.soldier_id::text,
        'is_surprise', sl.is_surprise
        ) order by sl.starts_at, sl.id)
      from slots sl
      left join ranks rmin on rmin.id = sl.rank_min_id
      left join ranks rmax on rmax.id = sl.rank_max_id
      left join penalties pen on pen.id = sl.penalty_id and pen.target_type = 'soldier'
      where sl.cycle_id = p_cycle and sl.cancelled_at is null), '[]'),

    'settings', jsonb_build_object(
      'night_window',       app.setting('night_window'),
      -- the engine uses Python weekdays (Monday = 0); settings use ISO (Monday = 1)
      'weekend_weekdays',   (select jsonb_agg(x::int - 1) from jsonb_array_elements_text(app.setting('weekend_weekdays')) x),
      'grace_days',         app.setting('grace_days'),
      'duty_cap_per_month', app.setting('duty_cap_per_month'),
      'weights',            app.setting('solver_weights'),
      'time_limit_seconds', app.setting('solver_time_limit_seconds'),
      'workers',            4,
      'surprise_multiplier', coalesce(app.setting('surprise_multiplier'), '1'),
      -- user-defined multipliers (the highest that applies wins) and the day types they look at
      'multipliers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', m.name, 'value', m.value, 'day_types', to_jsonb(m.day_types),
          -- Python weekdays (Monday = 0)
          'weekdays', (select coalesce(jsonb_agg(w - 1), '[]') from unnest(m.weekdays) w),
          'time_window', m.time_window, 'date_from', m.date_from, 'date_to', m.date_to,
          'skip_shabbat_types', m.skip_shabbat_types) order by m.sort_order, m.name)
        from score_multipliers m where m.is_active), '[]'),
      'day_types', coalesce((
        select jsonb_object_agg(day::text, day_type) from calendar_days
        where day between c.start_date - 1 and c.end_date + 7), '{}')),

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
      -- an activated reserve holds the slot as its performer; the performer it replaced is not
      -- kept on the slot (it already counts its days), so the engine can propose a new reserve
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text,
                                          'role', case when a.status = 'reserve_activated' then 'performer' else a.role::text end))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
        and not (a.role = 'performer' and exists (select 1 from assignments x where x.slot_id = a.slot_id
                                                   and x.status = 'reserve_activated' and x.replaced_assignment_id = a.id))
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
