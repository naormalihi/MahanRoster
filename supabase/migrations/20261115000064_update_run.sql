-- "עדכון שיבוץ": a run that starts from the current draft.
--
-- * build_solver_input(…, 'update') adds the engine's own draft assignments as "start"; the
--   engine keeps the months where they all still hold, repairs the others from them, then
--   balances the whole cycle.
-- * Every run (full or update) computes the potential again first, so changes to settings,
--   exemptions and personnel since the last computation are in.
-- * An update run counts as a scheduling run for the cycle's stages, like a full one.

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
        'is_weekend_type', t.is_weekend_type, 'includes_holidays', t.includes_holidays, 'shachar_compatible', t.shachar_compatible, 'shachar_only', t.shachar_only, 'tash_rule', t.tash_rule,
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
        'home_nightly', app.home_nightly_on(s, c.start_date), 'tash_level', s.tash_level,
        'recent_holiday', exists (select 1 from app.holiday_duties(c.start_date - 365, c.start_date - 1) h where h.soldier_id = s.id),
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
          'skip_shabbat_types', m.skip_shabbat_types,
          'holidays', to_jsonb(m.holidays), 'holiday_kinds', to_jsonb(m.holiday_kinds)) order by m.sort_order, m.name)
        from score_multipliers m where m.is_active), '[]'),
      'day_types', coalesce((
        select jsonb_object_agg(day::text, day_type) from calendar_days
        where day between c.start_date - 1 and c.end_date + 7), '{}'),
      -- which holiday a day belongs to, and which day of it (eve / the holiday / חול המועד)
      'day_holidays', coalesce((
        select jsonb_object_agg(day::text, jsonb_build_array(holiday, holiday_kind)) from calendar_days
        where holiday is not null and day between c.start_date - 1 and c.end_date + 7), '{}')),

    'holidays', coalesce((
      select jsonb_agg(day order by day) from calendar_days
      where day_type in (select code from day_types where counts_as_holiday) and day between c.start_date - 1 and c.end_date + 1), '[]'),

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

    -- An update run starts from the current draft: the engine's own draft assignments, which it
    -- keeps where they still hold and repairs where they no longer do.
    'start', case when p_kind = 'update' then coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', a.slot_id::text, 'soldier_id', a.soldier_id::text, 'role', a.role::text))
      from assignments a join slots sl on sl.id = a.slot_id
      where sl.cycle_id = p_cycle and sl.cancelled_at is null
        and a.status = 'draft' and a.source = 'solver' and a.role in ('performer', 'reserve')), '[]'::jsonb)
      else '[]'::jsonb end,

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

create or replace function public.cycle_stages(p_cycle uuid)
returns table (stage cycle_status, tone text, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  roster   timestamptz;
  pending  int;
  nslots   int;
  job      text;
  d        text := 'DD/MM';
begin
  perform app.require_reader();
  select * into c from cycles where id = p_cycle;
  if not found then return; end if;
  select max(created_at) into roster from roster_imports where kind = 'roster' and status = 'applied' and created_at >= c.created_at;
  select count(*) into pending from exemptions e where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date;
  select count(*) into nslots from slots where cycle_id = p_cycle and cancelled_at is null;
  select status::text into job from schedule_jobs where cycle_id = p_cycle and kind in ('full', 'stability', 'update') order by created_at desc limit 1;

  return query values
    ('draft'::cycle_status, 'done', 'נוצר ' || to_char(c.created_at at time zone app.tz(), d)),
    ('loading', case when roster is not null then 'done' else 'todo' end,
       case when roster is not null then 'נטען ' || to_char(roster at time zone app.tz(), d) else 'צריך לטעון קובץ כוח אדם עדכני' end),
    ('collecting', case when c.exemption_deadline is null then 'warn' when c.exemption_deadline <= now() then 'done' else 'todo' end,
       case when c.exemption_deadline is null then 'לא נקבע מועד סגירה'
            when c.exemption_deadline <= now() then 'נסגר ' || to_char(c.exemption_deadline at time zone app.tz(), d)
            else 'פתוח עד ' || to_char(c.exemption_deadline at time zone app.tz(), d) end),
    ('approving', case when pending > 0 then 'warn' when c.exemption_deadline <= now() then 'done' else 'todo' end,
       case when pending > 0 then pending || ' ממתינים' else 'אין ממתינים' end),
    ('potential', case when c.potential_computed_at is not null then 'done' else 'todo' end,
       case when c.potential_computed_at is not null then 'חושב ' || to_char(c.potential_computed_at at time zone app.tz(), d) else 'לא חושב' end),
    ('slots', case when nslots > 0 then 'done' else 'todo' end,
       case when nslots > 0 then nslots || ' משימות' else 'לא נקלט' end),
    ('scheduling', case when job in ('queued', 'running') then 'busy' when job = 'done' then 'done' when job = 'failed' then 'warn' else 'todo' end,
       case when job in ('queued', 'running') then 'רץ' when job = 'done' then 'הושלם' when job = 'failed' then 'נכשל' else 'לא הורץ' end),
    ('review', case when c.status in ('published', 'closed') then 'done' when job = 'done' then 'todo' else 'todo' end,
       case when c.status in ('published', 'closed') then 'אושרה' when job = 'done' then 'מחכה לבדיקה ולפרסום' else '' end),
    ('published', case when c.status in ('published', 'closed') then 'done' else 'todo' end,
       case when c.published_at is not null then 'פורסם ' || to_char(c.published_at at time zone app.tz(), d) else '' end),
    ('closed', case when c.status = 'closed' then 'done' else 'todo' end,
       'אחרי ' || to_char(c.end_date, d));
end $$;

create or replace function public.request_schedule(p_cycle uuid, p_kind job_kind default 'full') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_id uuid;
begin
  perform app.require_staff();
  if p_kind in ('full', 'update') and exists (select 1 from cycles where id = p_cycle and status in ('published', 'closed')) then
    raise exception 'the cycle is published – a full run would ignore the published board; changes go through day-to-day management';
  end if;
  if exists (select 1 from schedule_jobs where cycle_id = p_cycle and status in ('queued', 'running')) then
    raise exception 'a scheduling run is already in progress for this cycle';
  end if;
  -- the potential as it stands now: settings, exemptions and personnel may have changed
  if p_kind in ('full', 'update') then
    perform public.compute_potential(p_cycle);
  elsif not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    perform public.snapshot_cycle(p_cycle);
  end if;
  insert into schedule_jobs (cycle_id, kind, input, requested_by)
  values (p_cycle, p_kind, public.build_solver_input(p_cycle, p_kind), auth.uid())
  returning id into job_id;
  update cycles set status = 'scheduling' where id = p_cycle and status in ('draft', 'loading', 'collecting', 'approving', 'potential', 'slots', 'review', 'scheduling');
  return job_id;
end $$;
