-- =============================================================================
-- Briefing and reporting per duty type (תדריך והתייצבות), and a reminder before it.
--
-- * task_types.briefing: what the base's poster says for this duty, or null.
--     {"kind":  "briefing" | "report" | "by_call",      תדריך / התייצבות / לפי הזימון
--      "rule":  "same_day" | "day_before" | "weekday",
--      "weekday": 0..6 (0 = Sunday; for rule weekday: the last such day before the start, up to 7 days),
--      "time": "HH:MM", "place": text, "contact_name": text, "contact_phone": text, "note": text}
-- * app.slot_brief(slot): the briefing of one slot, computed from its duty type. A time or
--   place written on the slot itself (base schedule, operations) wins over the catalog.
-- * The soldier's duties and the board show the computed time and place; the contact and
--   the note only the soldier on the duty (my_duties).
-- * Reminders (app.queue_reminders, every 15 minutes):
--     - a briefing (or reporting) more than 12 hours before the start gets its own reminder,
--       settings.briefing_reminder_hours (default 24) before it – unless the soldier got the
--       duty after that moment (the assignment message already says when the briefing is);
--     - one closer to the start is written into the usual "תורנות מחר" reminder instead.
-- =============================================================================

alter table task_types add column if not exists briefing jsonb;

create or replace function app.briefing_valid(b jsonb) returns boolean
language sql immutable as $$
  select b is null or (
    jsonb_typeof(b) = 'object'
    and b->>'kind' in ('briefing', 'report', 'by_call')
    and (b->>'kind' = 'by_call' or (
          b->>'rule' in ('same_day', 'day_before', 'weekday')
          and coalesce(b->>'time', '') ~ '^([01]\d|2[0-3]):[0-5]\d$'
          and (b->>'rule' <> 'weekday' or coalesce(b->>'weekday', '') ~ '^[0-6]$')))
    and coalesce(length(b->>'place'), 0) <= 120
    and coalesce(length(b->>'contact_name'), 0) <= 80
    and coalesce(length(b->>'contact_phone'), 0) <= 30
    and coalesce(length(b->>'note'), 0) <= 300)
$$;

alter table task_types drop constraint if exists task_types_briefing_valid;
alter table task_types add constraint task_types_briefing_valid check (app.briefing_valid(briefing));

insert into settings (key, value) values ('briefing_reminder_hours', '24') on conflict (key) do nothing;

-- the briefing of a duty type for a duty starting at p_start (null for none / by call)
create or replace function app.briefing_time(b jsonb, p_start timestamptz) returns timestamptz
language plpgsql stable set search_path = public, pg_temp as $$
declare
  loc timestamp := p_start at time zone app.tz();
  d date := loc::date;
  t time;
begin
  if b is null or b->>'kind' = 'by_call' or b->>'time' is null then return null; end if;
  t := (b->>'time')::time;
  if b->>'rule' = 'day_before' then
    d := d - 1;
  elsif b->>'rule' = 'weekday' then
    -- the last such weekday whose time is not after the start (so at most 7 days before)
    d := d - ((extract(dow from d)::int - (b->>'weekday')::int + 7) % 7);
    if d + t > loc then d := d - 7; end if;
  end if;
  return (d + t) at time zone app.tz();
end $$;

drop function if exists app.slot_brief(uuid);
create or replace function app.slot_brief(p_slot uuid)
returns table (kind text, at timestamptz, place text, contact_name text, contact_phone text, note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.briefing->>'kind', app.briefing_time(t.briefing, s.starts_at), nullif(btrim(t.briefing->>'place'), ''),
         nullif(btrim(t.briefing->>'contact_name'), ''), nullif(btrim(t.briefing->>'contact_phone'), ''),
         nullif(btrim(t.briefing->>'note'), '')
  from slots s join task_types t on t.id = s.task_type_id
  where s.id = p_slot and t.briefing is not null
$$;
revoke execute on function app.slot_brief(uuid) from public, anon, authenticated;

-- One line for a notification: "תדריך ג׳ 17/11 13:00, גף אבטחה פיזית. איש קשר: שני משיח 052-…"
-- The slot's own time / place wins over the catalog. Null when there is nothing to say.
create or replace function app.brief_text(p_slot uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s slots; b record; kind text; at_ timestamptz; place text; who text; txt text;
begin
  select * into s from slots where id = p_slot;
  select * into b from app.slot_brief(p_slot);
  if s.briefing_at is not null then
    kind := 'briefing'; at_ := s.briefing_at; place := coalesce(s.briefing_place, case when b.kind = 'briefing' then b.place end);
  elsif s.report_at is not null then
    kind := 'report'; at_ := s.report_at; place := coalesce(s.report_place, case when b.kind = 'report' then b.place end);
  elsif b.kind is not null then
    kind := b.kind; at_ := b.at; place := coalesce(case when b.kind = 'report' then s.report_place else s.briefing_place end, b.place);
  else
    return null;
  end if;
  txt := case kind when 'report' then 'התייצבות ' else 'תדריך ' end
      || case when kind = 'by_call' then 'לפי הזימון' else app.when_text(at_) end
      || case when place is not null then ', ' || place else '' end;
  who := concat_ws(' ', b.contact_name, b.contact_phone);
  if who <> '' then txt := txt || '. איש קשר: ' || who; end if;
  if b.note is not null then txt := txt || '. ' || b.note; end if;
  return txt;
end $$;
revoke execute on function app.brief_text(uuid) from public, anon, authenticated;

-- When the separate briefing reminder is about: the briefing (or reporting) time, if more than
-- 12 hours before the start. Null = nothing separate (none, by call, or close to the start).
create or replace function app.early_brief_at(p_slot uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select case when x.at_ < s.starts_at - interval '12 hours' then x.at_ end
  from slots s
  left join lateral app.slot_brief(s.id) b on true
  cross join lateral (select coalesce(s.briefing_at, s.report_at,
                                      case when b.kind in ('briefing', 'report') then b.at end) as at_) x
  where s.id = p_slot
$$;
revoke execute on function app.early_brief_at(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create or replace function app.queue_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0; r record; brief text;
  lead interval := make_interval(hours => least(72, greatest(2, coalesce((app.setting('briefing_reminder_hours') #>> '{}')::int, 24))));
begin
  -- the day before a duty (performer, on a published board), once per duty
  for r in
    select a.id, a.soldier_id, sl.id as slot_id, sl.starts_at, coalesce(sl.special_name, t.name) as task
    from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id and c.status = 'published'
    join task_types t on t.id = sl.task_type_id
    where a.role = 'performer' and a.status in ('assigned', 'reserve_activated') and sl.cancelled_at is null
      and sl.starts_at between now() + interval '12 hours' and now() + interval '36 hours'
      and not exists (select 1 from notifications x where x.type = 'duty_reminder' and x.payload->>'assignment_id' = a.id::text)
  loop
    -- an early briefing has its own reminder; here only the reporting / a briefing near the start
    brief := case when app.early_brief_at(r.slot_id) is null then app.brief_text(r.slot_id) end;
    n := n + app.notify_soldier(r.soldier_id, 'duty_reminder', 'תזכורת: תורנות מחר',
      r.task || ', ' || app.when_text(r.starts_at) || coalesce('. ' || brief, ''),
      '/', jsonb_build_object('assignment_id', r.id));
  end loop;

  -- a briefing well before the start: its own reminder, lead hours before it, once per duty
  for r in
    select a.id, a.soldier_id, sl.id as slot_id, coalesce(sl.special_name, t.name) as task, x.at_
    from assignments a join slots sl on sl.id = a.slot_id join cycles c on c.id = sl.cycle_id and c.status = 'published'
    join task_types t on t.id = sl.task_type_id
    cross join lateral (select app.early_brief_at(sl.id) as at_) x
    where a.role = 'performer' and a.status in ('assigned', 'reserve_activated') and sl.cancelled_at is null
      and sl.starts_at > now() and sl.starts_at < now() + interval '10 days'
      and x.at_ is not null
      and now() >= x.at_ - lead and now() < x.at_ - interval '1 hour'
      -- got the duty (or saw the board) after the reminder's time: the assignment message said it
      and a.created_at <= x.at_ - lead and c.published_at <= x.at_ - lead
      and not exists (select 1 from notifications y where y.type = 'briefing_reminder' and y.payload->>'assignment_id' = a.id::text)
  loop
    n := n + app.notify_soldier(r.soldier_id, 'briefing_reminder',
      'תזכורת: ' || case when (select kind from app.slot_brief(r.slot_id)) = 'report'
                              and (select briefing_at from slots where id = r.slot_id) is null
                         then 'התייצבות' else 'תדריך' end || ' לתורנות',
      r.task || ' – ' || app.brief_text(r.slot_id),
      '/', jsonb_build_object('assignment_id', r.id));
  end loop;
  return n;
end $$;
revoke execute on function app.queue_reminders() from public, anon, authenticated;

-- The assignment message on a published board says when the briefing is (it may not get a reminder).
-- (As in 089, the swaps; only the briefing line is new.)
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
  brief text;
begin
  if tg_op = 'UPDATE' and (old.status = 'draft' or new.status = 'draft' or old.status = new.status) then return null; end if;
  if tg_op = 'INSERT' and new.status = 'draft' then return null; end if;
  -- a swap between soldiers sends its own notices (swap_done), not "removed" / "added"
  if (tg_op = 'INSERT' and new.source = 'swap') or (tg_op = 'UPDATE' and new.status = 'swapped_out') then return null; end if;
  select * into sl from slots where id = new.slot_id;
  if sl.starts_at <= now() or sl.cancelled_at is not null then return null; end if;
  select * into c from cycles where id = sl.cycle_id;
  if c.status <> 'published' then return null; end if;
  select coalesce(sl.special_name, name) into task from task_types where id = sl.task_type_id;
  what := task || ', ' || app.when_text(sl.starts_at);
  brief := app.brief_text(sl.id);

  if tg_op = 'INSERT' and new.status in ('assigned', 'reserve_idle') then
    perform app.notify_soldier(new.soldier_id, 'duty_added',
      case when new.role = 'performer' then 'שובצת לתורנות' else 'שובצת כעתודה' end, what || coalesce('. ' || brief, ''), '/',
      jsonb_build_object('assignment_id', new.id));
  elsif tg_op = 'UPDATE' and new.status = 'reserve_activated' then
    perform app.notify_soldier(new.soldier_id, 'reserve_activated', 'העתודה שלך הופעלה – אתה מבצע את התורנות', what || coalesce('. ' || brief, ''), '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status = 'reserve_activated' and new.status = 'reserve_idle' then
    -- the activation was undone: back to standing by
    perform app.notify_soldier(new.soldier_id, 'activation_undone', 'הפעלת העתודה בוטלה – אתה שוב עתודה', what, '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and old.status in ('dropped', 'done') and new.status in ('assigned', 'reserve_idle') then
    -- put back on the duty (an undone activation gives the performer his duty back)
    perform app.notify_soldier(new.soldier_id, 'duty_restored',
      case when new.role = 'performer' then 'חזרת לתורנות' else 'חזרת להיות עתודה' end, what || coalesce('. ' || brief, ''), '/',
      jsonb_build_object('assignment_id', new.id), true);
  elsif tg_op = 'UPDATE' and new.status in ('dropped', 'cancelled_approved', 'swapped_out')
        and old.status in ('assigned', 'reserve_idle', 'reserve_activated') then
    perform app.notify_soldier(new.soldier_id, 'duty_removed', 'תורנות ירדה ממך', what, '/',
      jsonb_build_object('assignment_id', new.id));
  end if;
  return null;
end $function$;

-- ---------------------------------------------------------------------------
-- What the soldier and the board see
-- ---------------------------------------------------------------------------
drop function if exists public.my_duties();
create function public.my_duties()
returns table (assignment_id uuid, cycle_id uuid, cycle_name text, task_name text, starts_at timestamptz, ends_at timestamptz,
               role assignment_role, status assignment_status, points numeric, explanation text,
               report_at timestamptz, report_place text, briefing_at timestamptz, briefing_place text, equipment text,
               briefing_by_call boolean, contact_name text, contact_phone text, briefing_note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, c.id, c.name, coalesce(sl.special_name, t.name), sl.starts_at, sl.ends_at, a.role, a.status, a.normalized_points, a.explanation,
         coalesce(sl.report_at, case when b.kind = 'report' then b.at end),
         coalesce(sl.report_place, case when b.kind = 'report' then b.place end),
         coalesce(sl.briefing_at, case when b.kind = 'briefing' then b.at end),
         coalesce(sl.briefing_place, case when b.kind in ('briefing', 'by_call') then b.place end),
         sl.equipment,
         coalesce(b.kind = 'by_call' and sl.briefing_at is null, false),
         b.contact_name, b.contact_phone, b.note
  from assignments a
  join slots sl on sl.id = a.slot_id
  join cycles c on c.id = sl.cycle_id and c.status in ('published', 'closed')
  join task_types t on t.id = sl.task_type_id
  left join lateral app.slot_brief(sl.id) b on true
  where a.soldier_id = app.my_soldier()
    and a.status not in ('draft', 'dropped', 'swapped_out', 'cancelled_approved')
    and sl.cancelled_at is null
  order by sl.starts_at
$$;
revoke execute on function public.my_duties() from public, anon;
grant execute on function public.my_duties() to authenticated;

-- the board: the computed time and place (no contact), and "לפי הזימון"
create or replace view published_board with (security_barrier = true) as
select
  s.id                                              as slot_id,
  c.id                                              as cycle_id,
  s.starts_at,
  s.ends_at,
  coalesce(s.special_name, tt.name)                as task_name,
  dc.name                                           as category_name,
  tt.color,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performers,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserves,
  coalesce(array_agg(distinct g.name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}')                   as gafim,
  coalesce(s.report_at, case when tt.briefing->>'kind' = 'report' then app.briefing_time(tt.briefing, s.starts_at) end) as report_at,
  coalesce(s.report_place, case when tt.briefing->>'kind' = 'report' then nullif(btrim(tt.briefing->>'place'), '') end) as report_place,
  coalesce(s.briefing_at, case when tt.briefing->>'kind' = 'briefing' then app.briefing_time(tt.briefing, s.starts_at) end) as briefing_at,
  coalesce(s.briefing_place, case when tt.briefing->>'kind' in ('briefing', 'by_call') then nullif(btrim(tt.briefing->>'place'), '') end) as briefing_place,
  greatest(s.updated_at, max(a.updated_at))         as updated_at,
  greatest(s.updated_at, max(a.updated_at)) > c.published_at as changed_after_publish,
  s.instructions,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'performer' or a.status = 'reserve_activated'), '{}') as performer_gafim,
  coalesce(array_agg(coalesce(g.name, '') order by so.full_name) filter (where a.role = 'reserve' and a.status <> 'reserve_activated'),   '{}') as reserve_gafim,
  coalesce(array_agg(so.full_name order by so.full_name) filter (where a.status = 'reserve_activated'), '{}') as activated,
  coalesce((select array_agg(so2.full_name order by so2.full_name)
            from assignments ra join assignments rp on rp.id = ra.replaced_assignment_id join soldiers so2 on so2.id = rp.soldier_id
            where ra.slot_id = s.id and ra.status = 'reserve_activated'), '{}')                                as replaced,
  s.fixed_points                                    as special_points,
  (tt.briefing->>'kind' = 'by_call' and s.briefing_at is null) is true as briefing_by_call
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
group by s.id, c.id, tt.name, dc.name, tt.color, tt.briefing;

-- ---------------------------------------------------------------------------
-- The base's poster (זמני תורנויות), for the duty types that have nothing yet.
-- Matched by name / category / service; a type נע"ת already filled is kept.
-- ---------------------------------------------------------------------------
do $$
declare
  no_swaps constant text := 'לא מאושרות החלפות בעת ביצוע התורנות!';
begin
  -- מטבח: התייצבות ביום התחלת התורנות (חמישי) 08:30, חד"א חוגרים
  update task_types set briefing = jsonb_build_object('kind', 'report', 'rule', 'same_day', 'time', '08:30',
      'place', 'חד"א חוגרים', 'contact_name', 'קובי יאיר לוי', 'contact_phone', '052-6454412', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false and name like '%מטבח%';

  -- רס"ר שק"ם (בקטלוג: רס"ר): התייצבות 08:30, שק"ם
  update task_types set briefing = jsonb_build_object('kind', 'report', 'rule', 'same_day', 'time', '08:30',
      'place', 'שק"ם', 'contact_name', 'לינוי בכר', 'contact_phone', '050-5728648', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and (name like '%שק"ם%' or btrim(name) in ('רס"ר', 'רס"ר – חול', 'רס"ר – שבת'));

  -- רס"ר (השאר, כמו רס"ר הקלת ת"ש): התייצבות 09:00, מש"ק תורנים
  update task_types set briefing = jsonb_build_object('kind', 'report', 'rule', 'same_day', 'time', '09:00',
      'place', 'מש"ק תורנים', 'contact_name', 'גור מוצפי', 'contact_phone', '053-5299336', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and (name like '%רס"ר%' or name like '%רסר%'
          or category_id in (select id from duty_categories where name = 'רס"ר'));

  -- ק. הגנ"ק: התייצבות 09:00, גף הגנה קרקעית
  update task_types set briefing = jsonb_build_object('kind', 'report', 'rule', 'same_day', 'time', '09:00',
      'place', 'גף הגנה קרקעית', 'contact_name', 'חמ"ל הגנ"ק', 'contact_phone', '0392-2939', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false and name like '%הגנ"ק%';

  -- מפקד תורן: תדריך לפי הזימון
  update task_types set briefing = jsonb_build_object('kind', 'by_call', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false and name like '%מפקד תורן%';

  -- ק. תורן (חול ושבת): תדריך 09:00 ביום התורנות, גף רס"ר
  update task_types set briefing = jsonb_build_object('kind', 'briefing', 'rule', 'same_day', 'time', '09:00',
      'place', 'גף רס"ר', 'contact_name', 'יובל זקס', 'contact_phone', '052-8322051', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and (name like '%קצין תורן%' or name like 'ק. תורן%'
          or category_id in (select id from duty_categories where name = 'קצין תורן'));

  -- ממלכת יום: תדריך 11:00 ביום התורנות, טלפוני
  update task_types set briefing = jsonb_build_object('kind', 'briefing', 'rule', 'same_day', 'time', '11:00',
      'place', 'טלפוני', 'contact_name', 'אופיר איליה', 'contact_phone', '052-5040077', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and replace(name, '"', '') like '%ממלכת יום%';

  -- שמירות חובה (אבט"פ): תדריך ביום שלישי שלפני, 13:00, גף אבטחה פיזית
  update task_types set briefing = jsonb_build_object('kind', 'briefing', 'rule', 'weekday', 'weekday', 2, 'time', '13:00',
      'place', 'גף אבטחה פיזית', 'contact_name', 'שני משיח', 'contact_phone', '052-2636289', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and category_id in (select id from duty_categories where name = 'שמירות חובה');

  -- שמירות קבע (אבט"פ): כל תורנות קבע שנשארה, ומפקד שער – תדריך ביום שלישי שלפני, 09:30
  update task_types set briefing = jsonb_build_object('kind', 'briefing', 'rule', 'weekday', 'weekday', 2, 'time', '09:30',
      'place', 'גף אבטחה פיזית', 'contact_name', 'שני משיח', 'contact_phone', '052-2636289', 'note', no_swaps)
   where briefing is null and coalesce(is_special, false) = false
     and (service_restriction = 'career' or name like '%מפקד שער%'
          or category_id in (select id from duty_categories where name = 'מפקד שער'));
end $$;
