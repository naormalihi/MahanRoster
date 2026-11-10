-- The cycle's stage follows what was actually done – no manual "next / previous stage".
--
--   הקמת המחזור          the cycle exists
--   טעינת כוח אדם        a personnel file was loaded since the cycle was created
--   אילוצים: איסוף       the constraints deadline has passed
--   אילוצים: אישור פטורים no exemption of the cycle waits for a decision
--   פוטנציאל             the potential was computed
--   לוח הבסיס            the cycle has slots
--   שיבוץ / טיוטה / תפעול as before: a run, its result, publishing (and unpublishing)
--   סגור                 automatically after the cycle's last day
--
-- public.cycle_stages(cycle): every stage with a state (done / warn / todo / busy) and a note,
-- for the stepper. public.refresh_cycle_stages(): moves the stored status to match (the app
-- calls it when it loads the cycles); request_schedule moves any early stage to "scheduling".

create or replace function app.cycle_auto_status(c cycles) returns cycle_status
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when c.status in ('published') and c.end_date < (now() at time zone app.tz())::date then 'closed'::cycle_status
    when c.status not in ('draft', 'loading', 'collecting', 'approving', 'potential', 'slots') then c.status
    when not exists (select 1 from roster_imports r where r.kind = 'roster' and r.status = 'applied' and r.created_at >= c.created_at)
      then 'loading'
    when c.exemption_deadline is null or c.exemption_deadline > now() then 'collecting'
    when exists (select 1 from exemptions e where e.status = 'pending' and e.start_date <= c.end_date and e.end_date >= c.start_date)
      then 'approving'
    when c.potential_computed_at is null then 'potential'
    else 'slots'
  end
$$;

create or replace function public.refresh_cycle_stages() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform app.require_staff();
  update cycles c set status = app.cycle_auto_status(c) where c.status <> app.cycle_auto_status(c);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.refresh_cycle_stages() from anon, public;
grant execute on function public.refresh_cycle_stages() to authenticated;

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
  select status::text into job from schedule_jobs where cycle_id = p_cycle and kind in ('full', 'stability') order by created_at desc limit 1;

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
       case when nslots > 0 then nslots || ' משבצות' else 'לא נקלט' end),
    ('scheduling', case when job in ('queued', 'running') then 'busy' when job = 'done' then 'done' when job = 'failed' then 'warn' else 'todo' end,
       case when job in ('queued', 'running') then 'רץ' when job = 'done' then 'הושלם' when job = 'failed' then 'נכשל' else 'לא הורץ' end),
    ('review', case when c.status in ('published', 'closed') then 'done' when job = 'done' then 'todo' else 'todo' end,
       case when c.status in ('published', 'closed') then 'אושרה' when job = 'done' then 'מחכה לבדיקה ולפרסום' else '' end),
    ('published', case when c.status in ('published', 'closed') then 'done' else 'todo' end,
       case when c.published_at is not null then 'פורסם ' || to_char(c.published_at at time zone app.tz(), d) else '' end),
    ('closed', case when c.status = 'closed' then 'done' else 'todo' end,
       'אחרי ' || to_char(c.end_date, d));
end $$;
revoke execute on function public.cycle_stages(uuid) from anon, public;
grant execute on function public.cycle_stages(uuid) to authenticated;

-- a run moves any early stage on (the stage used to be set by hand)
create or replace function public.request_schedule(p_cycle uuid, p_kind job_kind default 'full') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_id uuid;
begin
  perform app.require_staff();
  if p_kind = 'full' and exists (select 1 from cycles where id = p_cycle and status in ('published', 'closed')) then
    raise exception 'the cycle is published – a full run would ignore the published board; changes go through day-to-day management';
  end if;
  if exists (select 1 from schedule_jobs where cycle_id = p_cycle and status in ('queued', 'running')) then
    raise exception 'a scheduling run is already in progress for this cycle';
  end if;
  if not exists (select 1 from cycle_soldier_snapshot where cycle_id = p_cycle) then
    perform public.snapshot_cycle(p_cycle);
  end if;
  insert into schedule_jobs (cycle_id, kind, input, requested_by)
  values (p_cycle, p_kind, public.build_solver_input(p_cycle, p_kind), auth.uid())
  returning id into job_id;
  update cycles set status = 'scheduling' where id = p_cycle and status in ('draft', 'loading', 'collecting', 'approving', 'potential', 'slots', 'review', 'scheduling');
  return job_id;
end $$;

update cycles c set status = app.cycle_auto_status(c) where c.status <> app.cycle_auto_status(c);
