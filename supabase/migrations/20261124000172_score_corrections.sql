-- =============================================================================
-- "תיקון ניקוד": staff correct an employee's current score by hand, with a reason.
--
-- Kept as a score adjustment (reason 'manual') tied to a cycle and dated the day before it
-- starts – so it is in that cycle's "earlier" score (also when the snapshot is rebuilt) and
-- in the cumulative score of the cycles after it, like points earned by duties.
-- Snapshots already taken that should count it are updated at once (and back on undo).
-- =============================================================================

alter table score_adjustments add column if not exists cycle_id uuid references cycles(id) on delete set null;

-- add (or take back) a correction in the snapshots that already count it
create or replace function app.apply_score_correction(p_soldier uuid, p_effective date, p_points numeric) returns void
language sql security definer set search_path = public, pg_temp as $$
  update cycle_soldier_snapshot sn
     set baseline_score = sn.baseline_score + p_points
    from cycles c
   where c.id = sn.cycle_id and sn.soldier_id = p_soldier
     and p_effective < c.start_date
     and p_effective >= c.start_date - make_interval(months => (app.setting('score_window_months') #>> '{}')::int);
$$;

create or replace function public.add_score_correction(p_soldier uuid, p_cycle uuid, p_points numeric, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c cycles;
  eff date;
  rid uuid;
  why text := nullif(btrim(p_reason), '');
begin
  perform app.require_staff();
  select * into c from cycles where id = p_cycle;
  if not found then raise exception 'המחזור לא נמצא'; end if;
  if not exists (select 1 from soldiers where id = p_soldier) then raise exception 'העובד לא נמצא'; end if;
  if p_points is null or p_points = 0 then raise exception 'תיקון של 0 לא משנה כלום'; end if;
  if abs(p_points) > 100 then raise exception 'תיקון – עד 100 נקודות'; end if;
  if why is null then raise exception 'כתוב סיבה לתיקון'; end if;
  if length(why) > 200 then raise exception 'סיבה – עד 200 תווים'; end if;
  eff := c.start_date - 1;
  insert into score_adjustments (soldier_id, points, effective_date, reason, note, created_by, cycle_id)
  values (p_soldier, round(p_points, 2), eff, 'manual', why, auth.uid(), p_cycle)
  returning id into rid;
  perform app.apply_score_correction(p_soldier, eff, round(p_points, 2));
  return rid;
end $$;

create or replace function public.delete_score_correction(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a score_adjustments;
begin
  perform app.require_staff();
  select * into a from score_adjustments where id = p_id and reason = 'manual';
  if a.id is null then raise exception 'התיקון לא נמצא'; end if;
  delete from score_adjustments where id = p_id;
  perform app.apply_score_correction(a.soldier_id, a.effective_date, -a.points);
end $$;

-- the corrections, newest first (all employees, or one)
create or replace function public.score_corrections(p_soldier uuid default null)
returns table (id uuid, soldier_id uuid, cycle_id uuid, cycle_name text, points numeric, reason text,
               created_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.soldier_id, a.cycle_id, c.name, a.points, a.note,
         coalesce(s.full_name, u.username), a.created_at
    from score_adjustments a
    left join cycles c on c.id = a.cycle_id
    left join app_users u on u.id = a.created_by
    left join soldiers s on s.id = u.soldier_id
   where app.is_staff() and a.reason = 'manual' and (p_soldier is null or a.soldier_id = p_soldier)
   order by a.created_at desc
$$;

revoke execute on function public.add_score_correction(uuid, uuid, numeric, text), public.delete_score_correction(uuid),
  public.score_corrections(uuid) from public, anon;
grant execute on function public.add_score_correction(uuid, uuid, numeric, text), public.delete_score_correction(uuid),
  public.score_corrections(uuid) to authenticated;
