-- =============================================================================
-- Base schedule import (קליטת לוח הבסיס).
--
-- * task_type_aliases: the base calls duties by its own names ("אמ"ת גבעת המורה",
--   "ש.ג דרום 7-11"); each name is mapped once to a duty type and remembered.
-- * slots.allowed_rank_ids: the base's rank column is often a list, not a range
--   ("סמל - רס"ל, סג"מ - סגן, קמ"א"); when set it replaces the duty's rank range.
-- * slots.instructions (shown on the board) and slots.notes (contacts and phones,
--   staff only – not in the published board).
-- =============================================================================

create table task_type_aliases (
  alias        text primary key check (length(trim(alias)) > 0),
  task_type_id uuid not null references task_types(id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table task_type_aliases enable row level security;
create policy staff_all on task_type_aliases for all to authenticated using (app.is_staff()) with check (app.is_staff());
revoke all on task_type_aliases from anon;
create trigger task_type_aliases_audit after insert or update or delete on task_type_aliases
  for each row execute function app.audit();

alter table slots
  add column if not exists allowed_rank_ids uuid[],
  add column if not exists instructions     text,
  add column if not exists notes            text,
  add column if not exists import_id        uuid references roster_imports(id) on delete set null,
  add column if not exists source_line      int;

-- The board shows the instructions (report time, equipment); notes with phones stay internal.
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
  s.instructions
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

create or replace function public.build_solver_input(p_cycle uuid, p_kind job_kind default 'full') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        cycles;
  c_from   timestamptz;
  c_to     timestamptz;
  doc      jsonb;
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'cycle % not found', p_cycle; end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    raise exception 'cycle % has no snapshot – run snapshot_cycle first', p_cycle;
  end if;
  c_from := c.start_date::timestamp at time zone app.tz();
  c_to   := (c.end_date + 1)::timestamp at time zone app.tz();

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
          case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then c.end_date end),
        'is_shachar', sn.is_shachar, 'qualifies_day_only', sn.qualifies_day_only,
        'balance_population', sn.balance_population, 'baseline_score', sn.baseline_score,
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
        'restricted_hours', e.restricted_hours))
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
