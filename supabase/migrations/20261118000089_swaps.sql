-- =============================================================================
-- Swaps between soldiers (החלפות).
--
-- A soldier with his own account offers one of his published duties (as performer or reserve)
-- to another soldier:
--   * handover – the other soldier takes it
--   * mutual   – they trade: each takes the other's duty, in the same role
-- The system offers only soldiers who can really take it (the checks of a manual assignment:
-- eligibility, rest, exemptions, absences, date blocks, overlapping duties) and who have an
-- account to answer with. When the other soldier accepts, the swap is done at once – no
-- approval – and נע"ת hears about it. Up to 24 hours (setting swap_cutoff_hours) before each
-- duty involved; a penalty duty is not swapped.
-- Points follow whoever does the duty; a swap is never a call-up (by choice, not by notice).
-- =============================================================================
insert into settings (key, value) values ('swap_cutoff_hours', '24') on conflict (key) do nothing;

alter table swap_requests add column if not exists decided_at timestamptz;
create index if not exists swap_requests_open on swap_requests (status) where status = 'pending_peer';

-- the candidate checks of a manual assignment, for one soldier or all; slot_candidates wraps it
CREATE OR REPLACE FUNCTION app.slot_candidates_for(p_slot uuid, p_only uuid DEFAULT NULL::uuid)
 RETURNS TABLE(soldier_id uuid, reasons text[], conflicts jsonb, cycle_points numeric, cycle_duties integer, in_slot text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  s        slots;
  t        task_types;
  c        cycles;
  first_d  date;
  last_d   date;
  from_ts  timestamptz;
  last_slot_day date;
  night_hit boolean;
begin
  select * into s from slots where id = p_slot;
  if not found then raise exception 'slot % not found', p_slot; end if;
  select * into t from task_types where id = s.task_type_id;
  select * into c from cycles where id = s.cycle_id;
  first_d := (s.starts_at at time zone app.tz())::date;
  last_d  := ((s.ends_at - interval '1 microsecond') at time zone app.tz())::date;
  from_ts := least(coalesce(s.briefing_at, s.starts_at), s.starts_at);
  select greatest(c.end_date, max((x.ends_at at time zone app.tz())::date)) into last_slot_day
  from slots x where x.cycle_id = c.id and x.cancelled_at is null;
  night_hit := app.slot_window_minutes(app.setting('night_window') #>> '{}', s) > 0;

  return query
  with sn as (
    select sn.*, so.gender, so.enlistment_date, so.release_date, so.unit_join_date, so.range_valid_until,
           so.tash_level, app.home_nightly_on(so, c.start_date) as home_nightly
    from cycle_soldier_snapshot sn join soldiers so on so.id = sn.soldier_id
    where sn.cycle_id = c.id and (p_only is null or sn.soldier_id = p_only)
  ),
  rk as (
    select coalesce(rmin.sort_order, tmin.sort_order) as lo, coalesce(rmax.sort_order, tmax.sort_order) as hi
    from (select 1) d
    left join ranks rmin on rmin.id = s.rank_min_id left join ranks rmax on rmax.id = s.rank_max_id
    left join ranks tmin on tmin.id = t.rank_min_id left join ranks tmax on tmax.id = t.rank_max_id
  ),
  mine as (   -- the soldier's other live duties in any cycle, with rest
    select a.soldier_id, a.slot_id, a.role, x.starts_at, x.ends_at, tt.name as task_name, tt.min_rest_hours
    from assignments a join slots x on x.id = a.slot_id join task_types tt on tt.id = x.task_type_id
    where a.status not in ('dropped', 'cancelled_approved', 'swapped_out') and x.cancelled_at is null
  )
  select sn.soldier_id,
    array_remove(array[
      case when t.service_restriction <> 'any' and sn.service_type::text <> t.service_restriction then 'service' end,
      case when t.qualifying_duty and not (sn.qualifies_day_only
             or (cardinality(t.eligible_populations) > 0 and t.eligible_populations && sn.populations)
             or exists (select 1 from exemptions e join exemption_type_duties d on d.exemption_type_id = e.exemption_type_id
                        where e.soldier_id = sn.soldier_id and e.status = 'approved' and d.effect = 'qualifies'
                          and d.task_type_id = t.id and e.start_date <= first_d and e.end_date >= last_d))
           then 'not_qualifying' end,
      case when not t.qualifying_duty and sn.qualifies_day_only then 'qualifying_only' end,
      case when not t.qualifying_duty and cardinality(t.eligible_populations) > 0
             and not (t.eligible_populations && sn.populations) then 'population' end,
      case when s.allowed_rank_ids is not null
             then case when not exists (select 1 from ranks r where r.id = any(s.allowed_rank_ids) and r.sort_order = coalesce(sn.rank_order, 0)) then 'rank' end
           when t.allowed_rank_ids is not null
             then case when not exists (select 1 from ranks r where r.id = any(t.allowed_rank_ids) and r.sort_order = coalesce(sn.rank_order, 0)) then 'rank' end
           when ((select lo from rk) is not null and coalesce(sn.rank_order, 0) < (select lo from rk))
             or ((select hi from rk) is not null and coalesce(sn.rank_order, 0) > (select hi from rk)) then 'rank' end,
      case when coalesce(s.gender, t.gender) is not null and sn.gender is distinct from coalesce(s.gender, t.gender) then 'gender' end,
      case when sn.is_shachar and sn.service_type = 'mandatory' and not t.shachar_compatible then 'shachar' end,
      case when t.shachar_only and not (sn.is_shachar and sn.service_type = 'mandatory') then 'shachar_only' end,
      case when sn.home_nightly and night_hit and t.tash_rule <> 'home' then 'home_nightly' end,
      case when t.tash_rule = 'closed' and (sn.home_nightly or sn.tash_level is not null) then 'tash_closed' end,
      -- הת"ש 3–6: nights on base in any week (this duty + his other duties) at most 7 − level
      case when not sn.home_nightly and sn.tash_level between 3 and 6 and exists (
             select 1 from (
               select app.week_of(n) as wk, count(*) as nights from (
                 select unnest(app.slot_nights(s)) as n
                 union all
                 select unnest(app.slot_nights(x)) from assignments a join slots x on x.id = a.slot_id
                 where a.soldier_id = sn.soldier_id and app.performs(a.role, a.status) and x.id <> s.id and x.cancelled_at is null
                   and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')
                   and x.starts_at < s.ends_at + interval '8 days' and x.ends_at > s.starts_at - interval '8 days'
               ) all_n group by 1
             ) w
             where w.wk in (select app.week_of(n) from unnest(app.slot_nights(s)) n)
               and w.nights > 7 - sn.tash_level) then 'tash_nights' end,
      case when t.requires_weapon and coalesce(sn.range_valid_until,
             case when coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then last_slot_day end) is distinct from null
             and coalesce(sn.range_valid_until, last_slot_day) < last_d then 'weapon_range'
           when t.requires_weapon and sn.range_valid_until is null
             and not coalesce((app.setting('assume_range_valid') #>> '{}')::boolean, false) then 'weapon_range' end,
      case when sn.enlistment_date is not null and first_d < sn.enlistment_date then 'not_enlisted' end,
      case when sn.release_date is not null and last_d > sn.release_date then 'released' end,
      case when sn.unit_join_date is not null
             and first_d < sn.unit_join_date + coalesce((app.setting('grace_days') #>> '{}')::int, 0) then 'grace' end,
      case when exists (
             select 1 from exemptions e join exemption_types et on et.id = e.exemption_type_id
             cross join lateral (select app.exemption_scope(e.exemption_type_id, e.excluded_task_type_ids) as scope) sc
             where e.soldier_id = sn.soldier_id and e.status = 'approved' and not et.qualifies_day_only
               and e.start_date <= last_d and e.end_date >= first_d
               and (sc.scope is null or t.id = any(sc.scope))
               and (e.restricted_hours is null or app.slot_window_minutes(e.restricted_hours, s) > 0)) then 'exemption' end,
      case when exists (select 1 from absences a where a.soldier_id = sn.soldier_id and a.status = 'active'
                        and a.starts_at < s.ends_at and a.ends_at > from_ts) then 'absence' end,
      case when exists (select 1 from date_blocks b where b.soldier_id = sn.soldier_id and b.status = 'active'
                        and b.day between (from_ts at time zone app.tz())::date and last_d) then 'date_block' end,
      case when exists (select 1 from personal_constraints pc where pc.soldier_id = sn.soldier_id
                        and (pc.valid_until is null or pc.valid_until >= first_d)
                        and (pc.task_type_id is null or pc.task_type_id = t.id)
                        and (pc.time_window is null or app.slot_window_minutes(pc.time_window, s) > 0)) then 'personal_constraint' end
    ], null),
    coalesce((
      select jsonb_agg(jsonb_build_object('slot_id', m.slot_id, 'task', m.task_name, 'role', m.role,
                                          'starts_at', m.starts_at, 'ends_at', m.ends_at) order by m.starts_at)
      from mine m
      where m.soldier_id = sn.soldier_id and m.slot_id <> s.id
        and m.starts_at < s.ends_at + make_interval(hours => t.min_rest_hours)
        and m.ends_at + make_interval(hours => m.min_rest_hours) > s.starts_at), '[]'::jsonb),
    sn.baseline_score + coalesce((
      select sum(a.normalized_points) from assignments a join slots x on x.id = a.slot_id
      where a.soldier_id = sn.soldier_id and x.cycle_id = c.id and app.performs(a.role, a.status)
        and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')), 0),
    (select count(*)::int from assignments a join slots x on x.id = a.slot_id
     where a.soldier_id = sn.soldier_id and x.cycle_id = c.id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out')),
    (select a.role::text from assignments a where a.slot_id = s.id and a.soldier_id = sn.soldier_id
       and a.status not in ('dropped', 'cancelled_approved', 'swapped_out') limit 1)
  from sn;
end $function$;
CREATE OR REPLACE FUNCTION public.slot_candidates(p_slot uuid)
 RETURNS TABLE(soldier_id uuid, reasons text[], conflicts jsonb, cycle_points numeric, cycle_duties integer, in_slot text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform app.require_staff();
  return query select * from app.slot_candidates_for(p_slot, null);
end $function$;

revoke execute on function app.slot_candidates_for(uuid, uuid) from anon, public, authenticated;

-- What stops a soldier from taking a duty, giving up another one of his (or none).
create or replace function app.swap_blockers(p_slot uuid, p_soldier uuid, p_giving_up uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select c.reasons
           || case when exists (select 1 from jsonb_array_elements(c.conflicts) x
                                where (x ->> 'slot_id')::uuid is distinct from p_giving_up) then array['conflict'] else '{}' end
           || case when c.in_slot is not null then array['in_slot'] else '{}' end
    from app.slot_candidates_for(p_slot, p_soldier) c), array['not_in_cycle'])
$$;

-- A duty that can be swapped: live, published, not a penalty, far enough ahead.
create or replace function app.swappable(a assignments) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s slots;
  c cycles;
  h int := coalesce((app.setting('swap_cutoff_hours') #>> '{}')::int, 24);
begin
  if a.id is null then return 'השיבוץ לא נמצא'; end if;
  if a.status not in ('assigned', 'reserve_idle') then return 'התורנות כבר לא משובצת כך'; end if;
  if a.is_penalty then return 'תורנות עונש לא מחליפים'; end if;
  select * into s from slots where id = a.slot_id;
  select * into c from cycles where id = s.cycle_id;
  if s.cancelled_at is not null then return 'התורנות בוטלה'; end if;
  if c.status <> 'published' then return 'הלוח לא מפורסם'; end if;
  if s.starts_at < now() + make_interval(hours => h) then
    return format('אפשר להחליף עד %s שעות לפני התורנות – עכשיו רק נע"ת משנה', h);
  end if;
  return null;
end $$;

-- soldiers who can answer a request: an account of their own, not locked
create or replace function app.has_account(p_soldier uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users u where u.soldier_id = p_soldier and not u.is_locked and u.deleted_at is null)
$$;

create or replace function app.duty_text(p_slot uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select t.name || ', ' || app.when_text(s.starts_at) from slots s join task_types t on t.id = s.task_type_id where s.id = p_slot
$$;

-- Whom he can give a duty of his to, and with whom he can trade it.
create or replace function public.swap_options(p_assignment uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  a assignments;
  s slots;
  why text;
  h int := coalesce((app.setting('swap_cutoff_hours') #>> '{}')::int, 24);
  handover jsonb;
  mutual jsonb;
begin
  select * into a from assignments where id = p_assignment;
  if me is null or a.soldier_id is distinct from me then raise exception 'זו לא תורנות שלך'; end if;
  why := app.swappable(a);
  if why is not null then raise exception '%', why; end if;
  select * into s from slots where id = a.slot_id;
  -- every soldier of the cycle against this duty, once
  create temp table if not exists _cand (soldier_id uuid, reasons text[], conflicts jsonb, in_slot text) on commit drop;
  truncate _cand;
  insert into _cand select c.soldier_id, c.reasons, c.conflicts, c.in_slot from app.slot_candidates_for(s.id, null) c;

  select coalesce(jsonb_agg(jsonb_build_object('soldier_id', so.id, 'name', so.full_name) order by so.full_name), '[]')
    into handover
  from _cand c join soldiers so on so.id = c.soldier_id
  where c.soldier_id <> me and so.is_active and app.has_account(so.id)
    and cardinality(c.reasons) = 0 and jsonb_array_length(c.conflicts) = 0 and c.in_slot is null;

  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]') into mutual from (
    select jsonb_build_object('soldier_id', so.id, 'name', so.full_name, 'assignment_id', b.id,
                              'task', t.name, 'starts_at', bs.starts_at, 'ends_at', bs.ends_at) as x
    from assignments b
    join slots bs on bs.id = b.slot_id
    join cycles bc on bc.id = bs.cycle_id and bc.status = 'published'
    join task_types t on t.id = bs.task_type_id
    join soldiers so on so.id = b.soldier_id
    join _cand c on c.soldier_id = b.soldier_id
    where bs.cycle_id = s.cycle_id and b.soldier_id <> me and b.role = a.role and b.status = a.status
      and not b.is_penalty and bs.cancelled_at is null and bs.id <> s.id
      and bs.starts_at >= now() + make_interval(hours => h)
      and so.is_active and app.has_account(so.id)
      -- he can take mine, giving up his
      and cardinality(c.reasons) = 0 and c.in_slot is null
      and not exists (select 1 from jsonb_array_elements(c.conflicts) k where (k ->> 'slot_id')::uuid <> bs.id)
      -- and I can take his, giving up mine
      and cardinality(app.swap_blockers(bs.id, me, s.id)) = 0
      and not exists (select 1 from swap_requests r where r.status = 'pending_peer'
                      and (r.assignment_id = b.id or r.counter_assignment_id = b.id))
    order by bs.starts_at
    limit 60
  ) q;
  return jsonb_build_object('handover', handover, 'mutual', mutual);
end $$;

create or replace function public.request_swap(p_assignment uuid, p_target uuid, p_counter uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  a assignments;
  b assignments;
  why text;
  new_id uuid;
  my_name text;
begin
  select * into a from assignments where id = p_assignment for update;
  if me is null or a.soldier_id is distinct from me then raise exception 'זו לא תורנות שלך'; end if;
  if p_target is null or p_target = me then raise exception 'צריך לבחור חייל אחר'; end if;
  why := app.swappable(a);
  if why is not null then raise exception '%', why; end if;
  if not app.has_account(p_target) then raise exception 'לחייל הזה אין חשבון במערכת – הוא לא יוכל לאשר'; end if;
  if exists (select 1 from swap_requests r where r.status = 'pending_peer'
             and (r.assignment_id = a.id or r.counter_assignment_id = a.id)) then
    raise exception 'כבר יש בקשת החלפה פתוחה על התורנות הזו';
  end if;
  if p_counter is null then
    if cardinality(app.swap_blockers(a.slot_id, p_target, null)) > 0 then
      raise exception 'החייל הזה לא יכול לקחת את התורנות';
    end if;
  else
    select * into b from assignments where id = p_counter for update;
    if b.soldier_id is distinct from p_target then raise exception 'התורנות שבחרת לא שלו'; end if;
    why := app.swappable(b);
    if why is not null then raise exception '%', why; end if;
    if b.role <> a.role then raise exception 'מתחלפים רק באותו תפקיד (מבצע או עתודה)'; end if;
    if (select cycle_id from slots where id = b.slot_id) <> (select cycle_id from slots where id = a.slot_id) then
      raise exception 'מתחלפים רק בתוך אותו מחזור';
    end if;
    if exists (select 1 from swap_requests r where r.status = 'pending_peer'
               and (r.assignment_id = b.id or r.counter_assignment_id = b.id)) then
      raise exception 'על התורנות שלו כבר יש בקשת החלפה פתוחה';
    end if;
    if cardinality(app.swap_blockers(a.slot_id, p_target, b.slot_id)) > 0
       or cardinality(app.swap_blockers(b.slot_id, me, a.slot_id)) > 0 then
      raise exception 'ההחלפה הזו לא אפשרית (זכאות, מנוחה או חפיפה)';
    end if;
  end if;
  insert into swap_requests (kind, assignment_id, requested_by, target_soldier_id, counter_assignment_id, status, received_via, received_at)
  values (case when p_counter is null then 'handover' else 'mutual' end, a.id, me, p_target, p_counter, 'pending_peer', 'system', now())
  returning swap_requests.id into new_id;
  select full_name into my_name from soldiers where soldiers.id = me;
  perform app.notify_soldier(p_target, 'swap_request', 'בקשת החלפה מ' || my_name,
    case when p_counter is null then 'מבקש שתיקח ממנו: ' || app.duty_text(a.slot_id)
         else 'מציע להתחלף: אתה לוקח ' || app.duty_text(a.slot_id) || ', הוא לוקח ' || app.duty_text(b.slot_id) end,
    '/', jsonb_build_object('swap_id', new_id), true);
  return new_id;
end $$;

-- One assignment moves to another soldier: the old row is "swapped out", a new one takes its place.
create or replace function app.swap_move(p_old uuid, p_to uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o assignments;
  s slots;
  pts record;
  new_id uuid;
begin
  select * into o from assignments where id = p_old for update;
  select * into s from slots where id = o.slot_id;
  update assignments set status = 'swapped_out' where id = o.id;
  select * into pts from app.slot_points(o.slot_id, p_to);
  insert into assignments (slot_id, soldier_id, gaf_id, role, status, is_penalty, points, factor_at_time, normalized_points,
                           weekend_units, explanation, source, replaced_assignment_id, paired_assignment_id, received_via, received_at)
  select o.slot_id, so.id, so.gaf_id, o.role, o.status, o.is_penalty, pts.raw,
         case when pts.normalized > 0 then round(pts.raw / pts.normalized, 2) else 1 end,
         pts.normalized, o.weekend_units, p_note, 'swap', o.id, o.paired_assignment_id, 'system', now()
  from soldiers so where so.id = p_to
  returning id into new_id;
  update assignments set paired_assignment_id = new_id where paired_assignment_id = o.id and id <> new_id;
  return new_id;
end $$;

create or replace function public.answer_swap(p_request uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  r swap_requests;
  a assignments;
  b assignments;
  why text;
  req_name text;
  tgt_name text;
  what text;
begin
  select * into r from swap_requests where id = p_request for update;
  if not found or me is null or r.target_soldier_id is distinct from me then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'pending_peer' then raise exception 'הבקשה כבר טופלה'; end if;
  select full_name into req_name from soldiers where id = r.requested_by;
  select full_name into tgt_name from soldiers where id = r.target_soldier_id;
  select * into a from assignments where id = r.assignment_id for update;
  what := app.duty_text(a.slot_id);
  if not p_accept then
    update swap_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = r.id;
    perform app.notify_soldier(r.requested_by, 'swap_declined', tgt_name || ' לא יכול להחליף', what, '/', jsonb_build_object('swap_id', r.id));
    return jsonb_build_object('status', 'rejected');
  end if;

  -- still valid? (the board may have changed since the request)
  why := case when a.soldier_id <> r.requested_by then 'התורנות כבר לא שלו' else app.swappable(a) end;
  if why is null and r.counter_assignment_id is not null then
    select * into b from assignments where id = r.counter_assignment_id for update;
    why := case when b.soldier_id <> me then 'התורנות שלך השתנתה' else app.swappable(b) end;
  end if;
  if why is null and (
       cardinality(app.swap_blockers(a.slot_id, me, b.slot_id)) > 0
       or (b.id is not null and cardinality(app.swap_blockers(b.slot_id, r.requested_by, a.slot_id)) > 0)) then
    why := 'ההחלפה כבר לא אפשרית (זכאות, מנוחה או חפיפה)';
  end if;
  if why is not null then
    update swap_requests set status = 'cancelled', decision_reason = why, decided_by = auth.uid(), decided_at = now() where id = r.id;
    perform app.notify_soldier(r.requested_by, 'swap_declined', 'ההחלפה עם ' || tgt_name || ' בוטלה', why, '/', jsonb_build_object('swap_id', r.id));
    return jsonb_build_object('status', 'cancelled', 'reason', why);
  end if;

  perform app.swap_move(a.id, me, 'החלפה: לקח את התורנות מ' || req_name);
  if b.id is not null then
    perform app.swap_move(b.id, r.requested_by, 'החלפה: לקח את התורנות מ' || tgt_name);
  end if;
  update swap_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = r.id;

  perform app.notify_soldier(r.requested_by, 'swap_done', tgt_name || ' אישר את ההחלפה',
    case when b.id is null then 'התורנות עברה אליו: ' || what
         else 'אתה ב' || app.duty_text(b.slot_id) || ' במקום ' || what end,
    '/', jsonb_build_object('swap_id', r.id), true);
  -- נע"ת hears about it (no approval needed)
  insert into notifications (recipient_user_id, type, payload)
  select distinct u.id, 'swap_done',
         jsonb_build_object('title', 'החלפה בוצעה: ' || req_name || ' ⇄ ' || tgt_name,
                            'body', case when b.id is null then tgt_name || ' לוקח את ' || what
                                         else what || ' ⇄ ' || app.duty_text(b.slot_id) end,
                            'url', '/cycle/operate', 'swap_id', r.id)
  from app_users u join user_roles ur on ur.user_id = u.id
  where ur.role in ('coordinator', 'deputy') and not u.is_locked
    and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_to is null or ur.valid_to > now());
  return jsonb_build_object('status', 'approved');
end $$;

create or replace function public.cancel_swap(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := app.my_soldier();
  r swap_requests;
begin
  select * into r from swap_requests where id = p_request for update;
  if not found or me is null or r.requested_by is distinct from me then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'pending_peer' then raise exception 'הבקשה כבר טופלה'; end if;
  update swap_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_reason = 'בוטלה על ידי המבקש' where id = r.id;
  update notifications set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now())
   where type = 'swap_request' and payload ->> 'swap_id' = r.id::text;
end $$;

-- His swap requests, sent and received, newest first.
create or replace function public.my_swaps()
returns table (id uuid, kind text, status text, mine boolean, other_name text,
               give_task text, give_starts_at timestamptz, give_ends_at timestamptz,
               take_task text, take_starts_at timestamptz, take_ends_at timestamptz,
               reason text, created_at timestamptz, expired boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.kind, r.status, r.requested_by = app.my_soldier(),
         case when r.requested_by = app.my_soldier() then tg.full_name else rq.full_name end,
         ta.name, sa.starts_at, sa.ends_at, tb.name, sb.starts_at, sb.ends_at,
         r.decision_reason, r.created_at,
         r.status = 'pending_peer' and least(sa.starts_at, coalesce(sb.starts_at, sa.starts_at))
           < now() + make_interval(hours => coalesce((app.setting('swap_cutoff_hours') #>> '{}')::int, 24))
  from swap_requests r
  join soldiers rq on rq.id = r.requested_by
  join soldiers tg on tg.id = r.target_soldier_id
  join assignments a on a.id = r.assignment_id join slots sa on sa.id = a.slot_id join task_types ta on ta.id = sa.task_type_id
  left join assignments b on b.id = r.counter_assignment_id left join slots sb on sb.id = b.slot_id
  left join task_types tb on tb.id = sb.task_type_id
  where app.my_soldier() is not null and app.my_soldier() in (r.requested_by, r.target_soldier_id)
    and r.created_at > now() - interval '60 days'
  order by r.created_at desc
$$;

-- For נע"ת: the swaps of the last weeks.
create or replace function public.swap_log()
returns table (id uuid, kind text, status text, requester text, target text, give_task text, give_starts_at timestamptz,
               take_task text, take_starts_at timestamptz, reason text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_reader();
  return query
  select r.id, r.kind, r.status, rq.full_name, tg.full_name, ta.name, sa.starts_at, tb.name, sb.starts_at,
         r.decision_reason, r.created_at, r.decided_at
  from swap_requests r
  join soldiers rq on rq.id = r.requested_by
  join soldiers tg on tg.id = r.target_soldier_id
  join assignments a on a.id = r.assignment_id join slots sa on sa.id = a.slot_id join task_types ta on ta.id = sa.task_type_id
  left join assignments b on b.id = r.counter_assignment_id left join slots sb on sb.id = b.slot_id
  left join task_types tb on tb.id = sb.task_type_id
  where r.created_at > now() - interval '60 days' and app.sees_soldier(r.requested_by)
  order by r.created_at desc;
end $$;

revoke execute on function app.swap_blockers(uuid, uuid, uuid), app.swappable(assignments), app.has_account(uuid),
  app.duty_text(uuid), app.swap_move(uuid, uuid, text) from anon, public, authenticated;
revoke execute on function public.swap_options(uuid), public.request_swap(uuid, uuid, uuid), public.answer_swap(uuid, boolean),
  public.cancel_swap(uuid), public.my_swaps(), public.swap_log() from anon, public;
grant execute on function public.swap_options(uuid), public.request_swap(uuid, uuid, uuid), public.answer_swap(uuid, boolean),
  public.cancel_swap(uuid), public.my_swaps(), public.swap_log() to authenticated, service_role;

-- no "removed" / "added" for the two halves of a swap
CREATE OR REPLACE FUNCTION app.on_assignment_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sl slots;
  c cycles;
  task text;
  what text;
begin
  if tg_op = 'UPDATE' and (old.status = 'draft' or new.status = 'draft' or old.status = new.status) then return null; end if;
  if tg_op = 'INSERT' and new.status = 'draft' then return null; end if;
  -- a swap between soldiers sends its own notices (swap_done), not "removed" / "added"
  if (tg_op = 'INSERT' and new.source = 'swap') or (tg_op = 'UPDATE' and new.status = 'swapped_out') then return null; end if;
  select * into sl from slots where id = new.slot_id;
  if sl.starts_at <= now() or sl.cancelled_at is not null then return null; end if;
  select * into c from cycles where id = sl.cycle_id;
  if c.status <> 'published' then return null; end if;
  select name into task from task_types where id = sl.task_type_id;
  what := task || ', ' || app.when_text(sl.starts_at);

  if tg_op = 'INSERT' and new.status in ('assigned', 'reserve_idle') then
    perform app.notify_soldier(new.soldier_id, 'duty_added',
      case when new.role = 'performer' then 'שובצת לתורנות' else 'שובצת כעתודה' end, what, '/',
      jsonb_build_object('assignment_id', new.id));
  elsif tg_op = 'UPDATE' and new.status = 'reserve_activated' then
    perform app.notify_soldier(new.soldier_id, 'reserve_activated', 'העתודה שלך הופעלה – אתה מבצע את התורנות', what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status = 'reserve_activated' and new.status = 'reserve_idle' then
    -- the activation was undone: back to standing by
    perform app.notify_soldier(new.soldier_id, 'activation_undone', 'הפעלת העתודה בוטלה – אתה שוב עתודה', what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status in ('dropped', 'done') and new.status in ('assigned', 'reserve_idle') then
    -- put back on the duty (an undone activation gives the performer his duty back)
    perform app.notify_soldier(new.soldier_id, 'duty_restored',
      case when new.role = 'performer' then 'חזרת לתורנות' else 'חזרת להיות עתודה' end, what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and new.status in ('dropped', 'cancelled_approved', 'swapped_out')
        and old.status in ('assigned', 'reserve_idle', 'reserve_activated') then
    perform app.notify_soldier(new.soldier_id, 'duty_removed', 'תורנות ירדה ממך', what, '/',
      jsonb_build_object('assignment_id', new.id));
  end if;
  return null;
end $function$;

-- a swap is by choice: never a call-up
create or replace function app.call_up_by_notice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sl slots;
  c cycles;
  binding constant assignment_status[] := array['assigned', 'reserve_activated', 'done']::assignment_status[];
  was boolean := case when tg_op = 'UPDATE' then old.is_surprise else false end;
  now_flag boolean;
  m numeric;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    new.is_surprise := old.is_surprise;
    return new;
  end if;
  if new.status <> all (binding) then
    now_flag := false;                                   -- not (or no longer) doing the duty
  elsif tg_op = 'UPDATE' and old.status = any (binding) then
    now_flag := old.is_surprise;                         -- assigned → done and the like: as it was
  elsif tg_op = 'UPDATE' and old.status = 'dropped' then
    now_flag := false;                                   -- given back his own duty: he was planned
  else
    select * into sl from slots where id = new.slot_id;
    select * into c from cycles where id = sl.cycle_id;
    now_flag := c.status = 'published' and c.published_at < now()   -- not the first publication
                and new.source <> 'swap'                                      -- a swap is by choice
                and sl.fixed_points is null and not sl.is_penalty_slot
                and sl.starts_at - now() < make_interval(hours => coalesce((app.setting('surprise_notice_hours') #>> '{}')::int, 72));
  end if;
  if now_flag is distinct from was then
    m := coalesce((app.setting('surprise_multiplier') #>> '{}')::numeric, 1);
    if m > 0 then
      if now_flag then
        new.points := round(new.points * m, 2);
        new.normalized_points := round(new.normalized_points * m, 2);
      else
        new.points := round(new.points / m, 2);
        new.normalized_points := round(new.normalized_points / m, 2);
      end if;
    end if;
  end if;
  new.is_surprise := now_flag;
  return new;
end $$;
